import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUPABASE_USER_ENDPOINT_TIMEOUT_MS,
  verifySupabaseAccessToken,
} from '../src/lib/supabase-auth';

const originalEnv = { ...process.env };

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
});
