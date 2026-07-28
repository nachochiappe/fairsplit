import { prisma } from '@fairsplit/db';

/**
 * Passkeys are a secondary sign-in method: the browser proves possession of a
 * credential, and the API trades a verified assertion for the same session
 * token that the magic-link flow issues. Nothing here touches Supabase.
 */

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_LABEL_MAX_LENGTH = 60;
export const MAX_PASSKEYS_PER_USER = 20;

export type ChallengePurpose = 'registration' | 'authentication';

export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  origins: string[];
}

/**
 * Origins are compared byte-for-byte against the origin the browser reports, so
 * a pasted trailing slash would reject every ceremony with nothing but an
 * "invalid origin" to go on. Strip it here rather than make that a deploy
 * puzzle.
 */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter((entry) => entry.length > 0);
}

function deriveRpIdFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/**
 * The RP ID has to match the site's registrable domain and the origins have to
 * match exactly, so both are configuration rather than something we can infer
 * from the request — a spoofed Host header would otherwise let an attacker
 * choose the RP ID that credentials are scoped to.
 */
export function getWebAuthnConfig(): WebAuthnConfig {
  const configuredOrigins = splitList(process.env.FAIRSPLIT_WEBAUTHN_ORIGINS ?? '');
  const origins =
    configuredOrigins.length > 0
      ? configuredOrigins
      : process.env.NODE_ENV !== 'production'
        ? ['http://localhost:3000']
        : [];

  if (origins.length === 0) {
    throw new Error('FAIRSPLIT_WEBAUTHN_ORIGINS is required to use passkeys.');
  }

  const rpId = process.env.FAIRSPLIT_WEBAUTHN_RP_ID?.trim() || deriveRpIdFromOrigin(origins[0]);
  if (!rpId) {
    throw new Error('FAIRSPLIT_WEBAUTHN_RP_ID is required to use passkeys.');
  }

  return {
    rpId,
    rpName: process.env.FAIRSPLIT_WEBAUTHN_RP_NAME?.trim() || 'Fairsplit',
    origins,
  };
}

export function isPasskeysConfigured(): boolean {
  try {
    getWebAuthnConfig();
    return true;
  } catch {
    return false;
  }
}

export async function storeChallenge(
  challenge: string,
  purpose: ChallengePurpose,
  userId: string | null,
): Promise<void> {
  await prisma.webAuthnChallenge.create({
    data: {
      challenge,
      purpose,
      userId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  await pruneExpiredChallenges();
}

/**
 * Consumes a challenge, returning false unless it existed, matched the expected
 * purpose and owner, and had not expired. The delete is what makes a challenge
 * single-use, so a captured response cannot be replayed inside the TTL.
 */
export async function consumeChallenge(
  challenge: string,
  purpose: ChallengePurpose,
  userId: string | null,
): Promise<boolean> {
  const deleted = await prisma.webAuthnChallenge.deleteMany({
    where: {
      challenge,
      purpose,
      userId,
      expiresAt: { gt: new Date() },
    },
  });
  return deleted.count === 1;
}

async function pruneExpiredChallenges(): Promise<void> {
  await prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}

/**
 * The credential's user handle. Encoding the user id directly means a
 * discoverable-credential assertion tells us which account to log in as without
 * a separate lookup table, and lets us cross-check the credential we resolved.
 */
export function userIdToUserHandle(userId: string): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(userId, 'utf8');
  const handle = new Uint8Array(bytes.byteLength);
  handle.set(bytes);
  return handle;
}

/** Copies out of the Prisma `Bytes` buffer so the view owns a plain ArrayBuffer. */
export function toCredentialPublicKey(publicKey: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(publicKey.byteLength);
  copy.set(publicKey);
  return copy;
}

export function userHandleToUserId(userHandleBase64Url: string): string | null {
  try {
    const decoded = Buffer.from(userHandleBase64Url, 'base64url').toString('utf8');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

const VALID_TRANSPORTS = new Set([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);

export function sanitizeTransports(transports: readonly string[] | undefined): string[] {
  if (!transports) {
    return [];
  }
  return [...new Set(transports.filter((transport) => VALID_TRANSPORTS.has(transport)))];
}

export function defaultPasskeyLabel(deviceType: string): string {
  return deviceType === 'multiDevice' ? 'Synced passkey' : 'Device passkey';
}
