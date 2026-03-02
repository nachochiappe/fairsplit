import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface SessionClaims {
  v: 1;
  userId: string;
  needsHouseholdSetup: boolean;
  iat: number;
  exp: number;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): string | null {
  if (!value || /[^A-Za-z0-9\-_]/.test(value)) {
    return null;
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function sign(payloadB64: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(payloadB64).digest('base64');
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function hasValidSecret(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.trim().length >= 32;
}

export function issueSessionToken(
  user: {
    id: string;
    householdId: string | null;
    onboardingHouseholdDecisionAt: Date | null;
  },
  secret: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    v: 1,
    userId: user.id,
    needsHouseholdSetup: user.householdId === null && user.onboardingHouseholdDecisionAt === null,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const payload = JSON.stringify(claims);
  const payloadB64 = toBase64Url(payload);
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): SessionClaims | null {
  if (!hasValidSecret(secret)) {
    throw new Error('FAIRSPLIT_SESSION_SECRET is required and must be at least 32 characters.');
  }

  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature || token.split('.').length !== 2) {
    return null;
  }

  const expected = sign(payloadB64, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
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

  const claims = parsed as Partial<SessionClaims>;
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.v !== 1 ||
    typeof claims.userId !== 'string' ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now
  ) {
    return null;
  }

  return {
    v: 1,
    userId: claims.userId,
    needsHouseholdSetup: Boolean(claims.needsHouseholdSetup),
    iat: claims.iat,
    exp: claims.exp,
  };
}

export function getSessionSecret(): string {
  const secret = process.env.FAIRSPLIT_SESSION_SECRET;
  if (hasValidSecret(secret)) {
    return secret;
  }
  if (process.env.NODE_ENV !== 'production') {
    return 'fairsplit-local-dev-session-secret-unsafe-change-me';
  }
  throw new Error('FAIRSPLIT_SESSION_SECRET is required and must be at least 32 characters.');
}
