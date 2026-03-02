import { createHmac, timingSafeEqual } from 'node:crypto';

interface SupabaseAuthIdentity {
  authUserId: string;
  email: string;
}

function normalizeAccessToken(rawToken: string): string {
  const trimmed = rawToken.trim();
  const bearerPrefix = /^Bearer\s+/i;
  return bearerPrefix.test(trimmed) ? trimmed.replace(bearerPrefix, '').trim() : trimmed;
}

function decodeJwtPart(part: string): Record<string, unknown> | null {
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function verifyHs256Jwt(token: string, secret: string): SupabaseAuthIdentity | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJwtPart(headerPart);
  const payload = decodeJwtPart(payloadPart);
  if (!header || !payload) {
    return null;
  }
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    return null;
  }

  const expectedSig = createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const givenSig = Buffer.from(signaturePart);
  const computedSig = Buffer.from(expectedSig);
  if (givenSig.length !== computedSig.length || !timingSafeEqual(givenSig, computedSig)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : null;
  if (!exp || exp <= now) {
    return null;
  }
  if (nbf && nbf > now) {
    return null;
  }

  const authUserId = typeof payload.sub === 'string' ? payload.sub : null;
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (!authUserId || !email) {
    return null;
  }

  return { authUserId, email };
}

async function verifyWithSupabaseUserEndpoint(accessToken: string): Promise<SupabaseAuthIdentity | null> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseApiKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseApiKey) {
    return null;
  }

  const response = await fetch(`${supabaseUrl.replace(/\/+$/g, '')}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseApiKey,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { id?: unknown; email?: unknown };
  const authUserId = typeof payload.id === 'string' ? payload.id : null;
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (!authUserId || !email) {
    return null;
  }
  return { authUserId, email };
}

export async function verifySupabaseAccessToken(accessToken: string): Promise<SupabaseAuthIdentity | null> {
  const normalizedToken = normalizeAccessToken(accessToken);
  if (!normalizedToken) {
    return null;
  }

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (jwtSecret && jwtSecret.trim().length > 0) {
    const verifiedWithSecret = verifyHs256Jwt(normalizedToken, jwtSecret);
    if (verifiedWithSecret) {
      return verifiedWithSecret;
    }
  }

  return verifyWithSupabaseUserEndpoint(normalizedToken);
}
