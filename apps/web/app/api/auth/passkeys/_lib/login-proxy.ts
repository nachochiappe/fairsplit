import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../../../../lib/request-id';
import { webLogger } from '../../../../../lib/server-logger';
import { applySessionCookies, isSameOrigin, readSessionToken, sanitizeJsonBody } from '../../../_lib/auth-cookies';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

/**
 * Proxies the two unauthenticated steps of passkey sign-in.
 *
 * These cannot go through `proxyMutation`: the caller has no session yet, so
 * there is no session cookie to forward and no CSRF token to double-submit. A
 * same-origin check is what stands in for CSRF here — and it is enough, because
 * neither step is a state change an attacker gains anything from forcing: the
 * options step only mints a challenge, and the verify step still requires a
 * signature from an authenticator the attacker does not control.
 */
export async function proxyPasskeyLoginStep(request: Request, upstreamPath: string): Promise<Response> {
  const requestId = getOrCreateRequestId(new Headers(request.headers));

  if (!isSameOrigin(request)) {
    webLogger.warn({ method: 'POST', requestId, route: upstreamPath }, 'Rejected passkey login with invalid request origin');
    return appendRequestId(Response.json({ error: 'Invalid request origin.' }, { status: 403 }), requestId);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(`${API_BASE_URL}${upstreamPath}`, {
      method: 'POST',
      headers: withRequestId({ 'Content-Type': 'application/json' }, requestId),
      body: await request.text(),
      cache: 'no-store',
    });
  } catch (error) {
    webLogger.error({ err: error, method: 'POST', requestId, route: upstreamPath }, 'Passkey login proxy failed to reach API');
    return appendRequestId(Response.json({ error: 'Failed to reach API.' }, { status: 502 }), requestId);
  }

  const responseBody = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json';
  const upstreamRequestId = upstreamResponse.headers.get(REQUEST_ID_HEADER) ?? requestId;
  if (upstreamResponse.status >= 500) {
    webLogger.error(
      { method: 'POST', requestId: upstreamRequestId, route: upstreamPath, upstreamStatus: upstreamResponse.status },
      'Passkey login proxy received API 5xx response',
    );
  }

  const isJsonResponse = contentType.includes('application/json');
  const response = new NextResponse(isJsonResponse ? sanitizeJsonBody(responseBody) : responseBody, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });

  if (upstreamResponse.ok && isJsonResponse) {
    const sessionToken = readSessionToken(responseBody);
    if (sessionToken) {
      applySessionCookies(response, sessionToken);
    }
  }

  return appendRequestId(response, upstreamRequestId);
}
