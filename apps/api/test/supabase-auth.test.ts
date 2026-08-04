import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  SUPABASE_USER_ENDPOINT_TIMEOUT_MS,
  verifySupabaseAccessToken,
} from '../src/lib/supabase-auth';

const originalEnv = { ...process.env };

function toBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('verifySupabaseAccessToken', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
    };
    delete process.env.SUPABASE_JWT_SECRET;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it('passes an abort signal to the Supabase user endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'auth-user', email: 'USER@example.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifySupabaseAccessToken('opaque-access-token')).resolves.toEqual({
      authUserId: 'auth-user',
      email: 'user@example.com',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/user',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('aborts an unresponsive Supabase request at the fixed deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      ),
    );

    const verification = verifySupabaseAccessToken('opaque-access-token');
    const expectation = expect(verification).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(SUPABASE_USER_ENDPOINT_TIMEOUT_MS);
    await expectation;
  });

  it('verifies a local HS256 fixture without calling the remote endpoint', async () => {
    const jwtSecret = 'fairsplit-test-supabase-jwt-secret';
    process.env.SUPABASE_JWT_SECRET = jwtSecret;
    process.env.SUPABASE_JWT_AUDIENCE = 'authenticated';
    delete process.env.SUPABASE_JWT_ISSUER;
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const header = toBase64Url({ alg: 'HS256', typ: 'JWT' });
    const payload = toBase64Url({
      sub: 'test-auth-user',
      email: 'USER@example.com',
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const signature = createHmac('sha256', jwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    await expect(verifySupabaseAccessToken(`${header}.${payload}.${signature}`)).resolves.toEqual({
      authUserId: 'test-auth-user',
      email: 'user@example.com',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
