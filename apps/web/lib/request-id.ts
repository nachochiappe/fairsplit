import { REQUEST_ID_HEADER } from '@fairsplit/logging';

export function getOrCreateRequestId(headers: Headers): string {
  return headers.get(REQUEST_ID_HEADER)?.trim() || crypto.randomUUID();
}

export function appendRequestId(response: Response, requestId: string): Response {
  if (!response.headers.get(REQUEST_ID_HEADER)) {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  }
  return response;
}

export function withRequestId(headersInit: HeadersInit | undefined, requestId: string): Headers {
  const headers = new Headers(headersInit ?? {});
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
}
