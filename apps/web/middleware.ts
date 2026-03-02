import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { CSRF_COOKIE, SESSION_COOKIE } from './lib/session';
import { verifySessionCookieToken } from './lib/session-server';

function secureCookie(): boolean {
  return process.env.NODE_ENV === 'production';
}

function maybeSetCsrfCookie(request: NextRequest, response: NextResponse, loggedIn: boolean): NextResponse {
  if (!loggedIn || request.cookies.get(CSRF_COOKIE)?.value) {
    return response;
  }

  response.cookies.set({
    name: CSRF_COOKIE,
    value: crypto.randomUUID().replace(/-/g, ''),
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'lax',
    secure: secureCookie(),
    httpOnly: false,
  });
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await verifySessionCookieToken(request.cookies.get(SESSION_COOKIE)?.value);
  const loggedIn = session !== null;
  const requiresSetup = Boolean(session?.needsHouseholdSetup);

  if (pathname === '/auth/callback') {
    return maybeSetCsrfCookie(request, NextResponse.next(), loggedIn);
  }

  if (pathname === '/login') {
    if (loggedIn) {
      return maybeSetCsrfCookie(
        request,
        NextResponse.redirect(new URL(requiresSetup ? '/onboarding/household' : '/dashboard', request.url)),
        loggedIn,
      );
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/onboarding/household')) {
    if (!loggedIn) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    if (!requiresSetup) {
      return maybeSetCsrfCookie(request, NextResponse.redirect(new URL('/dashboard', request.url)), loggedIn);
    }
    return maybeSetCsrfCookie(request, NextResponse.next(), loggedIn);
  }

  if (!loggedIn) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (requiresSetup) {
    return maybeSetCsrfCookie(request, NextResponse.redirect(new URL('/onboarding/household', request.url)), loggedIn);
  }

  return maybeSetCsrfCookie(request, NextResponse.next(), loggedIn);
}

export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
    '/incomes/:path*',
    '/expenses/:path*',
    '/settings/:path*',
    '/onboarding/household',
    '/auth/callback',
    '/login',
  ],
};
