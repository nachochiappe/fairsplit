import { execSync } from 'node:child_process';
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

const repoRoot = resolve(__dirname, '..');
loadDotEnvFile(resolve(repoRoot, '.env'));
loadDotEnvFile(resolve(repoRoot, '.env.local'));
loadDotEnvFile(resolve(repoRoot, 'apps/web/.env.local'));
loadDotEnvFile(resolve(repoRoot, 'apps/api/.env'));

const env = {
  agentmailApiKey: process.env.AGENTMAIL_API_KEY,
  agentmailBaseUrl: process.env.AGENTMAIL_BASE_URL ?? 'https://api.agentmail.to/v0',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  appUrl: process.env.E2E_APP_URL ?? 'http://localhost:3100',
  apiBaseUrl: process.env.E2E_API_BASE_URL ?? 'http://localhost:4100/api',
  timeoutMs: Number(process.env.E2E_EMAIL_TIMEOUT_MS ?? 300000),
  pollMs: Number(process.env.E2E_EMAIL_POLL_MS ?? 3000),
  inviterInboxId: process.env.E2E_AGENTMAIL_INVITER_INBOX_ID,
  joinerInboxId: process.env.E2E_AGENTMAIL_JOINER_INBOX_ID,
  forceLocalCallback: process.env.E2E_FORCE_LOCAL_CALLBACK !== 'false',
};

function assertEnv(): void {
  const missing: string[] = [];
  if (!env.agentmailApiKey) missing.push('AGENTMAIL_API_KEY');
  if (!env.supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!env.supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

interface AgentmailInbox {
  inbox_id: string;
}

interface AgentmailListInboxesResponse {
  inboxes?: AgentmailInbox[];
}

interface AgentmailMessageSummary {
  message_id: string;
  created_at: string;
  subject?: string | null;
}

interface AgentmailListMessagesResponse {
  messages?: AgentmailMessageSummary[];
}

interface AgentmailMessage {
  message_id: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  extracted_text?: string | null;
  extracted_html?: string | null;
}

interface SessionPayload {
  userId: string;
  householdId: string | null;
  needsHouseholdSetup?: boolean;
  email?: string | null;
  authUserId?: string | null;
  onboardingHouseholdDecisionAt?: string | null;
}

interface AuthIdentity {
  authUserId: string;
  email: string;
}

interface LocalAuthLinkResponse {
  user: {
    id: string;
    email: string | null;
    authUserId: string | null;
    householdId: string | null;
    onboardingHouseholdDecisionAt: string | null;
  };
  needsHouseholdSetup: boolean;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid JWT format.');
  }
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text}`);
  }
  return json as T;
}

async function createInbox(label: string): Promise<string> {
  try {
    const payload = await requestJson<AgentmailInbox>(`${env.agentmailBaseUrl}/inboxes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.agentmailApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        display_name: `Fairsplit ${label}`,
      }),
    });
    return payload.inbox_id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('LimitExceededError') && !message.includes('Inbox limit exceeded')) {
      throw error;
    }
    const inboxes = await listInboxes();
    if (inboxes.length === 0) {
      throw new Error('AgentMail inbox limit exceeded and there are no existing inboxes to reuse.');
    }
    return inboxes[0];
  }
}

async function listInboxes(): Promise<string[]> {
  const response = await requestJson<AgentmailListInboxesResponse>(`${env.agentmailBaseUrl}/inboxes?limit=50`, {
    headers: {
      Authorization: `Bearer ${env.agentmailApiKey}`,
    },
  });
  return (response.inboxes ?? []).map((inbox) => inbox.inbox_id);
}

async function resolveInboxes(): Promise<{ inviterInbox: string; joinerInbox: string }> {
  if (env.inviterInboxId && env.joinerInboxId) {
    return { inviterInbox: env.inviterInboxId, joinerInbox: env.joinerInboxId };
  }

  const inviterInbox = env.inviterInboxId ?? (await createInbox('Inviter'));
  const joinerInbox = env.joinerInboxId ?? (await createInbox('Joiner'));
  if (inviterInbox !== joinerInbox) {
    return { inviterInbox, joinerInbox };
  }

  const available = await listInboxes();
  const alternative = available.find((inbox) => inbox !== inviterInbox);
  if (!alternative) {
    throw new Error(
      'Only one AgentMail inbox is available. Provide E2E_AGENTMAIL_INVITER_INBOX_ID and E2E_AGENTMAIL_JOINER_INBOX_ID.',
    );
  }
  return { inviterInbox, joinerInbox: alternative };
}

async function sendMagicLink(email: string): Promise<void> {
  const redirectTo = `${env.appUrl}/auth/callback`;
  await requestJson(`${env.supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.supabaseAnonKey!,
    },
    body: JSON.stringify({
      email,
      create_user: true,
      options: {
        emailRedirectTo: redirectTo,
      },
    }),
  });
}

async function listMessages(inboxId: string): Promise<AgentmailMessageSummary[]> {
  const encodedInbox = encodeURIComponent(inboxId);
  const response = await requestJson<AgentmailListMessagesResponse>(`${env.agentmailBaseUrl}/inboxes/${encodedInbox}/messages?limit=25`, {
    headers: {
      Authorization: `Bearer ${env.agentmailApiKey}`,
    },
  });
  return response.messages ?? [];
}

async function getMessage(inboxId: string, messageId: string): Promise<AgentmailMessage> {
  const encodedInbox = encodeURIComponent(inboxId);
  const encodedMessage = encodeURIComponent(messageId);
  return requestJson<AgentmailMessage>(`${env.agentmailBaseUrl}/inboxes/${encodedInbox}/messages/${encodedMessage}`, {
    headers: {
      Authorization: `Bearer ${env.agentmailApiKey}`,
    },
  });
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractAuthLink(content: string): string | null {
  const decoded = decodeHtmlEntities(content);
  const callbackMatches = decoded.match(/https?:\/\/[^\s"'<>]+\/auth\/callback#[^\s"'<>]+/g);
  if (callbackMatches?.[0]) {
    return callbackMatches[0];
  }
  const verifyMatches = decoded.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/g);
  return verifyMatches?.[0] ?? null;
}

function normalizeAuthLink(rawLink: string): string {
  if (!rawLink.includes('/auth/v1/verify?')) {
    return rawLink;
  }
  if (!env.forceLocalCallback) {
    return rawLink;
  }
  const url = new URL(rawLink);
  url.searchParams.set('redirect_to', `${env.appUrl}/auth/callback`);
  return url.toString();
}

async function waitForAuthLink(inboxId: string, startedAtMs: number): Promise<string> {
  const deadline = Date.now() + env.timeoutMs;
  while (Date.now() < deadline) {
    const messages = await listMessages(inboxId);
    for (const message of messages) {
      const createdAtMs = Date.parse(message.created_at);
      if (!Number.isNaN(createdAtMs) && createdAtMs + 1000 < startedAtMs) {
        continue;
      }
      const full = await getMessage(inboxId, message.message_id);
      const candidates = [
        full.extracted_html,
        full.html,
        full.extracted_text,
        full.text,
      ].filter((value): value is string => Boolean(value));

      for (const candidate of candidates) {
        const link = extractAuthLink(candidate);
        if (link) {
          return normalizeAuthLink(link);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, env.pollMs));
  }

  throw new Error(`Timed out waiting for auth link in inbox ${inboxId}`);
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

async function postAppApi<T>(path: string, userId: string, body: unknown): Promise<T> {
  return requestJson<T>(`${env.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-fairsplit-user-id': userId,
    },
    body: JSON.stringify(body),
  });
}

async function getSetupStatus(userId: string): Promise<{ needsHouseholdSetup: boolean; decisionLocked: boolean }> {
  return requestJson<{ needsHouseholdSetup: boolean; decisionLocked: boolean }>(`${env.apiBaseUrl}/household/setup-status`, {
    headers: {
      'x-fairsplit-user-id': userId,
    },
  });
}

async function resolveIdentityFromAuthLink(authLink: string): Promise<AuthIdentity> {
  const url = new URL(authLink);
  if (url.hash.includes('access_token=')) {
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
    const accessToken = hashParams.get('access_token');
    if (!accessToken) {
      throw new Error('Callback hash link is missing access_token.');
    }
    const payload = decodeJwtPayload(accessToken);
    const authUserId = typeof payload.sub === 'string' ? payload.sub : null;
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    if (!authUserId || !email) {
      throw new Error('Could not extract auth identity from callback token.');
    }
    return { authUserId, email };
  }

  if (!url.pathname.includes('/auth/v1/verify')) {
    throw new Error(`Unsupported auth link format: ${authLink}`);
  }

  const tokenHash = url.searchParams.get('token');
  const type = url.searchParams.get('type') ?? 'signup';
  if (!tokenHash) {
    throw new Error('Supabase verify link is missing token.');
  }

  const verifyResponse = await requestJson<{
    user?: { id?: string; email?: string | null };
    access_token?: string;
  }>(`${env.supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.supabaseAnonKey!,
    },
    body: JSON.stringify({
      token_hash: tokenHash,
      type,
    }),
  });

  const fromUser = verifyResponse.user?.id && verifyResponse.user?.email
    ? { authUserId: verifyResponse.user.id, email: verifyResponse.user.email.toLowerCase() }
    : null;
  if (fromUser) {
    return fromUser;
  }

  if (!verifyResponse.access_token) {
    throw new Error('Supabase verify response did not include user identity.');
  }
  const payload = decodeJwtPayload(verifyResponse.access_token);
  const authUserId = typeof payload.sub === 'string' ? payload.sub : null;
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (!authUserId || !email) {
    throw new Error('Could not extract auth identity from verify response token.');
  }
  return { authUserId, email };
}

async function linkIdentityToLocalUser(identity: AuthIdentity): Promise<LocalAuthLinkResponse> {
  return requestJson<LocalAuthLinkResponse>(`${env.apiBaseUrl}/auth/link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      authUserId: identity.authUserId,
      email: identity.email,
    }),
  });
}

function persistSessionInBrowser(payload: LocalAuthLinkResponse): void {
  const sessionPayload: SessionPayload = {
    userId: payload.user.id,
    householdId: payload.user.householdId,
    email: payload.user.email,
    authUserId: payload.user.authUserId,
    onboardingHouseholdDecisionAt: payload.user.onboardingHouseholdDecisionAt,
    needsHouseholdSetup: payload.needsHouseholdSetup,
  };
  const encoded = encodeURIComponent(JSON.stringify(sessionPayload));
  const escapedValue = playwrightEscape(encoded);
  runPlaywright(`playwright-cli open '${env.appUrl}/login'`);
  runPlaywright(
    `playwright-cli run-code \"async (page) => { await page.goto('${env.appUrl}/login'); await page.context().addCookies([{ name: 'fairsplit_session', value: '${escapedValue}', url: '${env.appUrl}' }]); return { ok: true }; }\"`,
  );
}

async function joinWithCodeInUi(code: string): Promise<void> {
  const escaped = playwrightEscape(code);
  const output = runPlaywright(
    `playwright-cli run-code \"async (page) => { await page.goto('${env.appUrl}/onboarding/household'); await page.locator('#invite-code').fill('${escaped}'); await page.getByRole('button', { name: 'Join household' }).click(); await page.waitForURL('**/dashboard', { timeout: 15000 }); return { url: page.url() }; }\"`,
  );
  extractJsonResult<{ url: string }>(output);
}

async function main(): Promise<void> {
  assertEnv();

  console.log('Creating AgentMail inboxes...');
  const { inviterInbox, joinerInbox } = await resolveInboxes();
  console.log(`Inviter inbox: ${inviterInbox}`);
  console.log(`Joiner inbox: ${joinerInbox}`);

  console.log('Requesting magic links from Supabase...');
  const inviterStart = Date.now();
  await sendMagicLink(inviterInbox);
  const inviterAuthLink = await waitForAuthLink(inviterInbox, inviterStart);

  const joinerStart = Date.now();
  await sendMagicLink(joinerInbox);
  const joinerAuthLink = await waitForAuthLink(joinerInbox, joinerStart);

  console.log('Resolving inviter identity from real email auth link...');
  const inviterIdentity = await resolveIdentityFromAuthLink(inviterAuthLink);
  const inviterSession = await linkIdentityToLocalUser(inviterIdentity);
  console.log(`Inviter userId: ${inviterSession.user.id}`);

  console.log('Completing inviter setup and generating invite code...');
  await postAppApi('/household/skip-setup', inviterSession.user.id, {});
  const invite = await postAppApi<{ code: string; expiresAt: string }>('/household/invites', inviterSession.user.id, {});
  console.log(`Invite code: ${invite.code} (expires ${invite.expiresAt})`);

  console.log('Resolving joiner identity from real email auth link...');
  const joinerIdentity = await resolveIdentityFromAuthLink(joinerAuthLink);
  const joinerSession = await linkIdentityToLocalUser(joinerIdentity);
  console.log(`Joiner userId: ${joinerSession.user.id}`);
  persistSessionInBrowser(joinerSession);

  console.log('Joining household in UI with invite code...');
  await joinWithCodeInUi(invite.code);

  const joinerStatus = await getSetupStatus(joinerSession.user.id);
  if (joinerStatus.needsHouseholdSetup || !joinerStatus.decisionLocked) {
    throw new Error(`Joiner setup status invalid: ${JSON.stringify(joinerStatus)}`);
  }

  console.log('SUCCESS: Real-email login + invite onboarding flow passed.');
}

main().catch((error) => {
  console.error('E2E failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
