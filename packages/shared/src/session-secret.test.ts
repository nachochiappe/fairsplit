import { describe, expect, it } from 'vitest';
import {
  isSecureSessionSecret,
  MIN_SESSION_SECRET_LENGTH,
  TEST_SESSION_SECRET,
} from './session-secret';

describe('isSecureSessionSecret', () => {
  it('accepts an explicit sufficiently long secret', () => {
    expect(isSecureSessionSecret('zK9eW7pL4vN2cR8mQ5xB1sD6gH3jF0aT')).toBe(true);
  });

  it('rejects missing, short, and padded secrets', () => {
    expect(isSecureSessionSecret(undefined)).toBe(false);
    expect(isSecureSessionSecret('x'.repeat(MIN_SESSION_SECRET_LENGTH - 1))).toBe(false);
    expect(isSecureSessionSecret(` ${'x'.repeat(MIN_SESSION_SECRET_LENGTH)}`)).toBe(false);
  });

  it.each([
    'CHANGE_ME_TO_A_RANDOM_32_PLUS_CHAR_SECRET',
    'change_me_to_a_random_32_plus_char_secret',
    'fairsplit-local-dev-session-secret-unsafe-change-me',
  ])('rejects the known insecure value %s', (secret) => {
    expect(isSecureSessionSecret(secret)).toBe(false);
  });

  it('allows the deterministic test secret only when explicitly requested', () => {
    expect(isSecureSessionSecret(TEST_SESSION_SECRET)).toBe(false);
    expect(isSecureSessionSecret(TEST_SESSION_SECRET, { allowTestSecret: true })).toBe(true);
  });
});
