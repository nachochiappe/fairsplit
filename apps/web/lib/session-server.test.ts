import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_SECRET_CONFIGURATION_ERROR, TEST_SESSION_SECRET } from '@fairsplit/shared';
import { verifySessionCookieToken } from './session-server';

const SECURE_SESSION_SECRET = 'zK9eW7pL4vN2cR8mQ5xB1sD6gH3jF0aT';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('server session secret configuration', () => {
  it('requires an explicitly configured secret in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FAIRSPLIT_SESSION_SECRET', '');

    await expect(verifySessionCookieToken(undefined)).rejects.toThrow(
      SESSION_SECRET_CONFIGURATION_ERROR,
    );
  });

  it.each([
    'CHANGE_ME_TO_A_RANDOM_32_PLUS_CHAR_SECRET',
    'fairsplit-local-dev-session-secret-unsafe-change-me',
  ])('rejects the known insecure value %s', async (secret) => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FAIRSPLIT_SESSION_SECRET', secret);

    await expect(verifySessionCookieToken(undefined)).rejects.toThrow(
      SESSION_SECRET_CONFIGURATION_ERROR,
    );
  });

  it('accepts an explicit secure secret', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FAIRSPLIT_SESSION_SECRET', SECURE_SESSION_SECRET);

    await expect(verifySessionCookieToken(undefined)).resolves.toBeNull();
  });

  it('accepts the deterministic test secret only in the test environment', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FAIRSPLIT_SESSION_SECRET', TEST_SESSION_SECRET);
    await expect(verifySessionCookieToken(undefined)).rejects.toThrow(
      SESSION_SECRET_CONFIGURATION_ERROR,
    );

    vi.stubEnv('NODE_ENV', 'test');
    await expect(verifySessionCookieToken(undefined)).resolves.toBeNull();
  });
});
