export const SESSION_COOKIE = 'fairsplit_session';
export const CSRF_COOKIE = 'fairsplit_csrf';

export interface SessionPayload {
  v: 1;
  userId: string;
  needsHouseholdSetup: boolean;
  iat: number;
  exp: number;
}

function decodeBase64Url(input: string): string | null {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    if (typeof atob === 'function') {
      return atob(padded);
    }
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export function parseSessionToken(sessionToken: string | undefined): SessionPayload | null {
  if (!sessionToken) {
    return null;
  }

  const [payloadPart] = sessionToken.split('.');
  if (!payloadPart) {
    return null;
  }
  const payloadJson = decodeBase64Url(payloadPart);
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as Partial<SessionPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (parsed.exp <= now) {
      return null;
    }
    return {
      v: 1,
      userId: parsed.userId,
      needsHouseholdSetup: Boolean(parsed.needsHouseholdSetup),
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function getSessionCookieValueFromBrowser(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const cookiePair = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
  return cookiePair ? cookiePair.slice(`${SESSION_COOKIE}=`.length) : null;
}

export function getCsrfCookieValueFromBrowser(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const cookiePair = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
  return cookiePair ? cookiePair.slice(`${CSRF_COOKIE}=`.length) : null;
}
