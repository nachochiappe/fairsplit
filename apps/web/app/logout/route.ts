import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../lib/request-id';
import { webLogger } from '../../lib/server-logger';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../lib/session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
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

  if (sessionToken) {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/logout`, {
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
            route: '/auth/logout',
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
          route: '/auth/logout',
        },
        'Logout route failed to reach API',
      );
    }
  }

  const response = NextResponse.redirect(new URL('/login', request.url));
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
