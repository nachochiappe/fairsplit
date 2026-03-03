import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnvFile(pathname: string): void {
  if (!existsSync(pathname)) {
    return;
  }
  const lines = readFileSync(pathname, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signHs256(input: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(input)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildFakeSupabaseAccessToken(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signHs256(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function runPlaywright(command: string): string {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });
}

function extractJsonResult<T>(output: string): T {
  const marker = '### Result';
  const markerIndex = output.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Could not parse Playwright result. Output:\n${output}`);
  }
  const afterMarker = output.slice(markerIndex + marker.length).trimStart();
  const endMarker = '\n###';
  const endIndex = afterMarker.indexOf(endMarker);
  const jsonBlock = (endIndex === -1 ? afterMarker : afterMarker.slice(0, endIndex)).trim();
  return JSON.parse(jsonBlock) as T;
}

function playwrightEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

interface BrowserProbeResult {
  url: string;
  pathname: string;
  hasSessionCookie: boolean;
  hasCsrfCookie: boolean;
  authLinkStatuses: number[];
}

const repoRoot = resolve(__dirname, '..');
loadDotEnvFile(resolve(repoRoot, '.env'));
loadDotEnvFile(resolve(repoRoot, '.env.local'));
loadDotEnvFile(resolve(repoRoot, 'apps/web/.env.local'));
loadDotEnvFile(resolve(repoRoot, 'apps/api/.env'));

const env = {
  appUrl: process.env.E2E_APP_URL ?? 'http://localhost:3100',
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET,
  supabaseJwtAudience: process.env.SUPABASE_JWT_AUDIENCE ?? 'authenticated',
  supabaseJwtIssuer:
    process.env.SUPABASE_JWT_ISSUER ??
    (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL.replace(/\/+$/g, '')}/auth/v1` : null),
};

function assertEnv(): void {
  if (!env.supabaseJwtSecret || env.supabaseJwtSecret.trim().length === 0) {
    throw new Error('SUPABASE_JWT_SECRET is required to simulate callback auth locally.');
  }
}

async function main(): Promise<void> {
  assertEnv();

  const now = Math.floor(Date.now() / 1000);
  const suffix = `${Date.now()}`;
  const email = `local.auth.${suffix}@example.com`;
  const authUserId = `local-auth-user-${suffix}`;

  const tokenPayload: Record<string, unknown> = {
    sub: authUserId,
    email,
    aud: env.supabaseJwtAudience,
    iat: now,
    nbf: now - 5,
    exp: now + 60 * 60,
  };
  if (env.supabaseJwtIssuer) {
    tokenPayload.iss = env.supabaseJwtIssuer;
  }

  const accessToken = buildFakeSupabaseAccessToken(tokenPayload, env.supabaseJwtSecret!);
  const callbackUrl = `${env.appUrl}/auth/callback#access_token=${accessToken}`;
  const escapedCallbackUrl = playwrightEscape(callbackUrl);
  const escapedAppUrl = playwrightEscape(env.appUrl);

  console.log(`Simulating magic-link callback for: ${email}`);
  runPlaywright(`playwright-cli open '${escapedAppUrl}/login'`);

  const output = runPlaywright(
    `playwright-cli run-code "async (page) => {
      const authLinkStatuses = [];
      const pathnameFromUrl = (value) => {
        const withoutHash = value.split('#')[0];
        const withoutQuery = withoutHash.split('?')[0];
        const slashIndex = withoutQuery.indexOf('/', withoutQuery.indexOf('//') + 2);
        return slashIndex === -1 ? '/' : withoutQuery.slice(slashIndex);
      };
      page.on('response', (response) => {
        if (response.url().includes('/api/auth/link')) {
          authLinkStatuses.push(response.status());
        }
      });

      await page.goto('${escapedCallbackUrl}', { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForURL((value) => {
          const pathname = pathnameFromUrl(value.toString());
          return pathname === '/dashboard' || pathname === '/onboarding/household' || pathname === '/login';
        }, { timeout: 15000 });
      } catch {}
      await page.waitForTimeout(750);

      const cookies = await page.context().cookies();
      const hasSessionCookie = cookies.some((cookie) => cookie.name === 'fairsplit_session');
      const hasCsrfCookie = cookies.some((cookie) => cookie.name === 'fairsplit_csrf');
      const url = page.url();
      return {
        url,
        pathname: pathnameFromUrl(url),
        hasSessionCookie,
        hasCsrfCookie,
        authLinkStatuses,
      };
    }"`,
  );

  const result = extractJsonResult<BrowserProbeResult>(output);
  console.log(`Final URL: ${result.url}`);
  console.log(`Auth link statuses: ${result.authLinkStatuses.join(', ') || 'none'}`);
  console.log(`Session cookie present: ${result.hasSessionCookie}`);

  if (result.pathname === '/login') {
    throw new Error('Flow ended on /login. Middleware likely treated the session as missing/invalid.');
  }
  if (!result.hasSessionCookie) {
    throw new Error('Missing fairsplit_session cookie after callback.');
  }
  if (!result.authLinkStatuses.some((status) => status >= 200 && status < 300)) {
    throw new Error('Did not observe a successful /api/auth/link (2xx) response.');
  }

  console.log('SUCCESS: Local callback auth flow passed.');
}

main().catch((error) => {
  console.error('E2E failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
