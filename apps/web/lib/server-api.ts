import 'server-only';
import { headers } from 'next/headers';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
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
