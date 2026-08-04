import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isSecureSessionSecret, SESSION_SECRET_CONFIGURATION_ERROR } from '@fairsplit/shared';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Bumped to 2 when sessions gained a `sid`, which is what lets logout revoke one
 * device instead of the whole account. Version 1 tokens carry no `sid` and are
 * rejected outright rather than grandfathered — there is no way to sign one out
 * individually, so honouring them would keep the old all-or-nothing behaviour
 * alive indefinitely.
 */
export const SESSION_CLAIMS_VERSION = 2;

export interface SessionClaims {
  v: typeof SESSION_CLAIMS_VERSION;
  /** Identifies this one session, so it can be revoked on its own. */
  sid: string;
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

function assertValidSecret(secret: string | undefined): asserts secret is string {
  if (!isSecureSessionSecret(secret, { allowTestSecret: process.env.NODE_ENV === 'test' })) {
    throw new Error(SESSION_SECRET_CONFIGURATION_ERROR);
  }
}

export function issueSessionToken(
  user: {
    id: string;
    householdId: string | null;
    onboardingHouseholdDecisionAt: Date | null;
    sessionRevokedAt?: Date | null;
  },
  secret: string,
): string {
  assertValidSecret(secret);

  const now = Math.floor(Date.now() / 1000);
  // Logout invalidates every session issued at or before `sessionRevokedAt`.
  // A passkey sign-in can land in the same second as the logout that preceded
  // it, so nudge `iat` past the revocation rather than handing back a token the
  // very next request would reject.
  const revokedAt = user.sessionRevokedAt
    ? Math.floor(user.sessionRevokedAt.getTime() / 1000)
    : null;
  const issuedAt = revokedAt !== null ? Math.max(now, revokedAt + 1) : now;
  const claims: SessionClaims = {
    v: SESSION_CLAIMS_VERSION,
    sid: randomBytes(16).toString('base64url'),
    userId: user.id,
    needsHouseholdSetup: user.householdId === null && user.onboardingHouseholdDecisionAt === null,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  };
  const payload = JSON.stringify(claims);
  const payloadB64 = toBase64Url(payload);
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): SessionClaims | null {
  assertValidSecret(secret);

  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature || token.split('.').length !== 2) {
    return null;
  }

  const expected = sign(payloadB64, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
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
    claims.v !== SESSION_CLAIMS_VERSION ||
    typeof claims.sid !== 'string' ||
    claims.sid.length === 0 ||
    typeof claims.userId !== 'string' ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now
  ) {
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

export function getSessionSecret(): string {
  const secret = process.env.FAIRSPLIT_SESSION_SECRET;
  assertValidSecret(secret);
  return secret;
}
