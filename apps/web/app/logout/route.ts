import { NextResponse } from 'next/server';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../lib/session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const sessionCookiePrefix = `${SESSION_COOKIE}=`;
  const sessionToken = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(sessionCookiePrefix))
    ?.slice(sessionCookiePrefix.length);

  if (sessionToken) {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'x-fairsplit-session': sessionToken,
      },
      cache: 'no-store',
    }).catch(() => null);
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
  return response;
}
