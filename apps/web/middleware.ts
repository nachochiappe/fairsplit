import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'fairsplit_session';

function hasSession(request: NextRequest): boolean {
  return Boolean(request.cookies.get(SESSION_COOKIE)?.value);
}

function needsHouseholdSetup(request: NextRequest): boolean {
  const rawCookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!rawCookie) {
    return false;
  }

  try {
    const decoded = decodeURIComponent(rawCookie);
    const parsed = JSON.parse(decoded) as { needsHouseholdSetup?: unknown; householdId?: unknown };
    if (typeof parsed.needsHouseholdSetup === 'boolean') {
      return parsed.needsHouseholdSetup;
    }
    return !(typeof parsed.householdId === 'string' && parsed.householdId.trim().length > 0);
  } catch {
    return false;
  }
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
