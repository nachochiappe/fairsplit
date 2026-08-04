export const MIN_SESSION_SECRET_LENGTH = 32;

/**
 * A deterministic key reserved for isolated tests. It must never be accepted by
 * a development or production runtime.
 */
export const TEST_SESSION_SECRET = 'fairsplit-test-session-secret-32-chars-min';

const KNOWN_INSECURE_SESSION_SECRETS = new Set([
  'change_me_to_a_random_32_plus_char_secret',
  'fairsplit-local-dev-session-secret-unsafe-change-me',
]);

export const SESSION_SECRET_CONFIGURATION_ERROR = `FAIRSPLIT_SESSION_SECRET must be explicitly set to a random value of at least ${MIN_SESSION_SECRET_LENGTH} characters.`;

export function isSecureSessionSecret(
  secret: string | undefined,
  options: { allowTestSecret?: boolean } = {},
): secret is string {
  if (
    typeof secret !== 'string' ||
    secret.length < MIN_SESSION_SECRET_LENGTH ||
    secret !== secret.trim()
  ) {
    return false;
  }

  const normalizedSecret = secret.toLowerCase();
  if (KNOWN_INSECURE_SESSION_SECRETS.has(normalizedSecret)) {
    return false;
  }

  if (secret === TEST_SESSION_SECRET) {
    return options.allowTestSecret === true;
  }

  return true;
}
