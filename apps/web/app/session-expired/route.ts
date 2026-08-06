import { NextResponse } from 'next/server';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../lib/session';

/**
 * Drops a session the API has already rejected.
 *
 * The proxy only checks the cookie's signature and expiry, so a session
 * revoked server-side (logging out revokes every session for the account, on
 * every device) still looks valid to it: the user gets routed into the app and
 * every request 401s. Clearing the cookies here is what turns that dead end
 * into a trip back to sign-in.
 *
 * Deliberately does not call the API's logout endpoint — the session is already
 * revoked, and revoking again would invalidate any newer session the user has
 * since obtained elsewhere.
 */
function clearSessionAndRedirect(request: Request): NextResponse {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('reason', 'session-expired');

  // 303: a POST that lands here must continue as a GET.
  const response = NextResponse.redirect(loginUrl, 303);
  for (const [name, httpOnly] of [
    [SESSION_COOKIE, true],
    [CSRF_COOKIE, false],
  ] as const) {
    response.cookies.set({
      name,
      value: '',
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly,
    });
  }
  return response;
}

export async function GET(request: Request): Promise<Response> {
  return clearSessionAndRedirect(request);
}

export async function POST(request: Request): Promise<Response> {
  return clearSessionAndRedirect(request);
}
