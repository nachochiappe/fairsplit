import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseSessionToken, SESSION_COOKIE } from './lib/session';

function hasSession(request: NextRequest): boolean {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return parseSessionToken(token) !== null;
}

function needsHouseholdSetup(request: NextRequest): boolean {
  const rawCookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!rawCookie) {
    return false;
  }
  const parsed = parseSessionToken(rawCookie);
  return Boolean(parsed?.needsHouseholdSetup);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const loggedIn = hasSession(request);
  const requiresSetup = needsHouseholdSetup(request);

  if (pathname === '/auth/callback') {
    return NextResponse.next();
  }

  if (pathname === '/login') {
    if (loggedIn) {
      return NextResponse.redirect(new URL(requiresSetup ? '/onboarding/household' : '/dashboard', request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/onboarding/household')) {
    if (!loggedIn) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    if (!requiresSetup) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  if (!loggedIn) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (requiresSetup) {
    return NextResponse.redirect(new URL('/onboarding/household', request.url));
  }

  return NextResponse.next();
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
