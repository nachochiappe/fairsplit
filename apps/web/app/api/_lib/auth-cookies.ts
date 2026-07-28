import { randomBytes } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../../lib/session';

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The session token never reaches the browser as data — every sign-in path
 * strips it from the response body and stores it in an httpOnly cookie instead.
 */
export function sanitizeJsonBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { sessionToken?: unknown };
    if (Object.prototype.hasOwnProperty.call(parsed, 'sessionToken')) {
      delete parsed.sessionToken;
      return JSON.stringify(parsed);
    }
    return body;
  } catch {
    return body;
  }
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }
  return origin === new URL(request.url).origin;
}

/**
 * Applies the session cookie plus a fresh CSRF token. Called whenever an
 * upstream response carries a new session token, so magic-link sign-in, passkey
 * sign-in, and mid-session token rotation all land in the same state.
 */
export function applySessionCookies(response: NextResponse, sessionToken: string): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: sessionToken,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: secureCookies(),
    httpOnly: true,
  });
  response.cookies.set({
    name: CSRF_COOKIE,
    value: generateCsrfToken(),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: secureCookies(),
    httpOnly: false,
  });
}

/** Reads a session token out of an upstream JSON body, if one is present. */
export function readSessionToken(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { sessionToken?: unknown };
    return typeof parsed.sessionToken === 'string' && parsed.sessionToken.length > 0 ? parsed.sessionToken : null;
  } catch {
    return null;
  }
}
