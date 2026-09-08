import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../../lib/session';
import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../../lib/request-id';
import { webLogger } from '../../../lib/server-logger';
import { isSameOrigin } from './auth-cookies';
import { forwardApiResponse } from './proxy-response';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

interface ProxyMutationOptions {
  upstreamPath: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
}

export async function proxyMutation(request: Request, options: ProxyMutationOptions): Promise<Response> {
  const requestId = getOrCreateRequestId(new Headers(request.headers));
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return appendRequestId(Response.json({ error: 'Missing authentication context.' }, { status: 401 }), requestId);
  }
  if (!isSameOrigin(request)) {
    webLogger.warn(
      {
        method: options.method,
        requestId,
        route: options.upstreamPath,
      },
      'Rejected mutation with invalid request origin',
    );
    return appendRequestId(Response.json({ error: 'Invalid request origin.' }, { status: 403 }), requestId);
  }

  const csrfCookie = cookieStore.get(CSRF_COOKIE)?.value;
  const csrfHeader = request.headers.get('x-fairsplit-csrf')?.trim();
  if (!csrfCookie || !csrfHeader || csrfHeader !== csrfCookie) {
    webLogger.warn(
      {
        method: options.method,
        requestId,
        route: options.upstreamPath,
      },
      'Rejected mutation with invalid CSRF token',
    );
    return appendRequestId(Response.json({ error: 'Invalid CSRF token.' }, { status: 403 }), requestId);
  }

  const rawBody = await request.text();
  const contentType = request.headers.get('content-type') ?? 'application/json';
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(`${API_BASE_URL}${options.upstreamPath}`, {
      method: options.method,
      headers: withRequestId(
        {
          'Content-Type': contentType,
          'x-fairsplit-session': sessionToken,
        },
        requestId,
      ),
      body: rawBody.length > 0 ? rawBody : undefined,
      cache: 'no-store',
    });
  } catch (error) {
    webLogger.error(
      {
        err: error,
        method: options.method,
        requestId,
        route: options.upstreamPath,
      },
      'Mutation proxy failed to reach API',
    );
    return appendRequestId(Response.json({ error: 'Failed to reach API.' }, { status: 502 }), requestId);
  }

  if (upstreamResponse.ok) {
    revalidatePath('/', 'layout');
  }
  return forwardApiResponse(upstreamResponse, {
    method: options.method,
    requestId,
    rotateSession: true,
    sanitizeJson: true,
    upstreamPath: options.upstreamPath,
  });
}
