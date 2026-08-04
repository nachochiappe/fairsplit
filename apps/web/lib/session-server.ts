import { SESSION_CLAIMS_VERSION, type SessionPayload } from './session';
import { isSecureSessionSecret, SESSION_SECRET_CONFIGURATION_ERROR } from '@fairsplit/shared';

function fromBase64Url(value: string): string | null {
  if (!value || /[^A-Za-z0-9\-_]/.test(value)) {
    return null;
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function getSessionSecret(): string {
  const configured = process.env.FAIRSPLIT_SESSION_SECRET;
  if (!isSecureSessionSecret(configured, { allowTestSecret: process.env.NODE_ENV === 'test' })) {
    throw new Error(SESSION_SECRET_CONFIGURATION_ERROR);
  }
  return configured;
}

async function sign(payloadB64: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return toBase64Url(new Uint8Array(signature));
}

export async function verifySessionCookieToken(
  token: string | undefined,
): Promise<SessionPayload | null> {
  const secret = getSessionSecret();
  if (!token) {
    return null;
  }

  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature || token.split('.').length !== 2) {
    return null;
  }

  const expectedSignature = await sign(payloadB64, secret);
  if (!timingSafeEqualString(signature, expectedSignature)) {
    return null;
  }

  const payloadJson = fromBase64Url(payloadB64);
  if (!payloadJson) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const claims = parsed as Partial<SessionPayload>;
  if (
    claims.v !== SESSION_CLAIMS_VERSION ||
    typeof claims.sid !== 'string' ||
    typeof claims.userId !== 'string' ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number'
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    return null;
  }

  return {
    v: SESSION_CLAIMS_VERSION,
    sid: claims.sid,
    userId: claims.userId,
    needsHouseholdSetup: Boolean(claims.needsHouseholdSetup),
    iat: claims.iat,
    exp: claims.exp,
  };
}
