import {
  WebAuthnError,
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { getCsrfCookieValueFromBrowser } from './session';
import type { AuthLinkResponse, Passkey } from './api';

/**
 * Browser half of the passkey flows. Kept out of `lib/api.ts` because
 * `@simplewebauthn/browser` touches `navigator.credentials` and only ever runs
 * client-side.
 */

/** Thrown when the user dismissed the OS prompt — not worth surfacing as an error. */
export class PasskeyCancelledError extends Error {
  constructor() {
    super('Passkey prompt was cancelled.');
    this.name = 'PasskeyCancelledError';
  }
}

export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && browserSupportsWebAuthn();
}

function isCancellation(error: unknown): boolean {
  if (error instanceof WebAuthnError) {
    return error.code === 'ERROR_CEREMONY_ABORTED';
  }
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = getCsrfCookieValueFromBrowser();
  if (csrf) {
    headers['x-fairsplit-csrf'] = csrf;
  }

  const response = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : 'Passkey request failed.';
    throw new Error(message);
  }
  return payload as T;
}

/** Enrolls a new passkey for the signed-in user. Requires an existing session. */
export async function registerPasskey(label?: string): Promise<Passkey> {
  const optionsJSON = await postJson<PublicKeyCredentialCreationOptionsJSON>(
    '/api/auth/passkeys/registration/options',
    {},
  );

  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON });
  } catch (error) {
    if (isCancellation(error)) {
      throw new PasskeyCancelledError();
    }
    if (error instanceof WebAuthnError && error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      throw new Error('This device already has a passkey for your account.');
    }
    throw error instanceof Error ? error : new Error('Could not create a passkey.');
  }

  return postJson<Passkey>('/api/auth/passkeys/registration/verify', {
    response: attestation,
    ...(label?.trim() ? { label: label.trim() } : {}),
  });
}

/**
 * Usernameless sign-in: the server sends a challenge with no credential filter,
 * so the browser shows its own account picker and we learn which user it was
 * from the assertion itself.
 */
export async function signInWithPasskey(): Promise<AuthLinkResponse> {
  const optionsJSON = await postJson<PublicKeyCredentialRequestOptionsJSON>(
    '/api/auth/passkeys/authentication/options',
    {},
  );

  let assertion;
  try {
    assertion = await startAuthentication({ optionsJSON });
  } catch (error) {
    if (isCancellation(error)) {
      throw new PasskeyCancelledError();
    }
    throw error instanceof Error ? error : new Error('Could not sign in with a passkey.');
  }

  return postJson<AuthLinkResponse>('/api/auth/passkeys/authentication/verify', { response: assertion });
}
