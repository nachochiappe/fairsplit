import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../../../../lib/request-id';
import { webLogger } from '../../../../../lib/server-logger';
import { isSameOrigin } from '../../../_lib/auth-cookies';
import { forwardApiResponse } from '../../../_lib/proxy-response';

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
    webLogger.warn(
      { method: 'POST', requestId, route: upstreamPath },
      'Rejected passkey login with invalid request origin',
    );
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
    webLogger.error(
      { err: error, method: 'POST', requestId, route: upstreamPath },
      'Passkey login proxy failed to reach API',
    );
    return appendRequestId(Response.json({ error: 'Failed to reach API.' }, { status: 502 }), requestId);
  }

  return forwardApiResponse(upstreamResponse, {
    method: 'POST',
    requestId,
    rotateSession: true,
    sanitizeJson: true,
    upstreamPath,
  });
}
