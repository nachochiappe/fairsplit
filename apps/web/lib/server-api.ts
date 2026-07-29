import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
import { isSessionExpiredError } from './api';
import { SESSION_EXPIRED_PATH } from './session';
import { webLogger } from './server-logger';

type ServerRequestInit = RequestInit & { next?: { revalidate?: number; tags?: string[] } };

export async function getServerRequestId(): Promise<string> {
  const incomingHeaders = await headers();
  return incomingHeaders.get(REQUEST_ID_HEADER)?.trim() || crypto.randomUUID();
}

export function buildServerApiInit(
  requestId: string,
  init?: ServerRequestInit,
  extraHeaders?: HeadersInit,
): ServerRequestInit {
  const headers = new Headers(init?.headers ?? {});
  const appendedHeaders = new Headers(extraHeaders ?? {});

  for (const [key, value] of appendedHeaders.entries()) {
    headers.set(key, value);
  }
  headers.set(REQUEST_ID_HEADER, requestId);

  return {
    ...(init ?? {}),
    headers,
  };
}

/**
 * Sends the user to sign in when the API rejects the session cookie, instead of
 * letting a 401 surface as a backend outage on a page the middleware already
 * let through. Anything else propagates untouched.
 *
 * `redirect` throws, so this must wrap the API reads directly rather than sit
 * inside another `catch`.
 */
export async function withSessionRecovery<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isSessionExpiredError(error)) {
      redirect(SESSION_EXPIRED_PATH);
    }
    throw error;
  }
}

export async function withServerApiLogging<T>(
  requestId: string,
  context: Record<string, unknown>,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    webLogger.error(
      {
        err: error,
        requestId,
        ...context,
      },
      'SSR API request failed',
    );
    throw error;
  }
}
