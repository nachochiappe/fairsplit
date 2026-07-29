import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../lib/request-id';
import { webLogger } from '../../lib/server-logger';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../lib/session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Reads the logout scope off the submitted form. Defaults to this device: an
 * account-wide sign-out has to be asked for explicitly, never inferred.
 */
async function readUpstreamPath(request: Request): Promise<'/auth/logout' | '/auth/logout-all'> {
  try {
    const form = await request.formData();
    return form.get('scope') === 'all' ? '/auth/logout-all' : '/auth/logout';
  } catch {
    return '/auth/logout';
  }
}

export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(new Headers(request.headers));
  const cookieHeader = request.headers.get('cookie') ?? '';
  const sessionCookiePrefix = `${SESSION_COOKIE}=`;
  const sessionToken = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(sessionCookiePrefix))
    ?.slice(sessionCookiePrefix.length);
  const upstreamPath = await readUpstreamPath(request);

  if (sessionToken) {
    try {
      const response = await fetch(`${API_BASE_URL}${upstreamPath}`, {
        method: 'POST',
        headers: withRequestId(
          {
            'x-fairsplit-session': sessionToken,
          },
          requestId,
        ),
        cache: 'no-store',
      });
      if (response.status >= 500) {
        webLogger.error(
          {
            method: 'POST',
            requestId: response.headers.get(REQUEST_ID_HEADER) ?? requestId,
            route: upstreamPath,
            upstreamStatus: response.status,
          },
          'Logout route received API 5xx response',
        );
      }
    } catch (error) {
      webLogger.error(
        {
          err: error,
          method: 'POST',
          requestId,
          route: upstreamPath,
        },
        'Logout route failed to reach API',
      );
    }
  }

  // 303, not the default 307: this is the response to a form POST, and a 307
  // would make the browser re-POST to /login, which has no POST handler.
  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
    secure: secureCookies(),
    httpOnly: true,
  });
  response.cookies.set({
    name: CSRF_COOKIE,
    value: '',
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
    secure: secureCookies(),
    httpOnly: false,
  });
  return appendRequestId(response, requestId);
}
