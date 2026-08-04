import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_SECRET_CONFIGURATION_ERROR, TEST_SESSION_SECRET } from '@fairsplit/shared';
import { getSessionSecret, issueSessionToken, verifySessionToken } from '../src/lib/session';

const SECURE_SESSION_SECRET = 'zK9eW7pL4vN2cR8mQ5xB1sD6gH3jF0aT';
const SESSION_USER = {
  id: 'session-secret-test-user',
  householdId: null,
  onboardingHouseholdDecisionAt: null,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('session secret configuration', () => {
  it('requires an explicitly configured secret in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FAIRSPLIT_SESSION_SECRET', '');

    expect(() => getSessionSecret()).toThrow(SESSION_SECRET_CONFIGURATION_ERROR);
  });

  it.each([
    'CHANGE_ME_TO_A_RANDOM_32_PLUS_CHAR_SECRET',
    'fairsplit-local-dev-session-secret-unsafe-change-me',
  ])('rejects the known insecure value %s', (secret) => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FAIRSPLIT_SESSION_SECRET', secret);

    expect(() => getSessionSecret()).toThrow(SESSION_SECRET_CONFIGURATION_ERROR);
    expect(() => issueSessionToken(SESSION_USER, secret)).toThrow(
      SESSION_SECRET_CONFIGURATION_ERROR,
    );
    expect(() => verifySessionToken('invalid.token', secret)).toThrow(
      SESSION_SECRET_CONFIGURATION_ERROR,
    );
  });

  it('uses an explicit secure secret', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FAIRSPLIT_SESSION_SECRET', SECURE_SESSION_SECRET);

    expect(getSessionSecret()).toBe(SECURE_SESSION_SECRET);
    const token = issueSessionToken(SESSION_USER, SECURE_SESSION_SECRET);
    expect(verifySessionToken(token, SECURE_SESSION_SECRET)?.userId).toBe(SESSION_USER.id);
  });

  it('accepts the deterministic test secret only in the test environment', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FAIRSPLIT_SESSION_SECRET', TEST_SESSION_SECRET);
    expect(() => getSessionSecret()).toThrow(SESSION_SECRET_CONFIGURATION_ERROR);

    vi.stubEnv('NODE_ENV', 'test');
    expect(getSessionSecret()).toBe(TEST_SESSION_SECRET);
  });
});
