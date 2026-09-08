import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
import { appendRequestId } from '../../../lib/request-id';
import { webLogger } from '../../../lib/server-logger';
import { applySessionCookies, readSessionToken, sanitizeJsonBody } from './auth-cookies';

const BODYLESS_STATUS_CODES = new Set([204, 205, 304]);

interface ForwardApiResponseOptions {
  method: string;
  requestId: string;
  rotateSession?: boolean;
  sanitizeJson?: boolean;
  upstreamPath: string;
}

export async function forwardApiResponse(
  upstreamResponse: Response,
  options: ForwardApiResponseOptions,
): Promise<Response> {
  const body = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json';
  const upstreamRequestId = upstreamResponse.headers.get(REQUEST_ID_HEADER) ?? options.requestId;

  if (upstreamResponse.status >= 500) {
    webLogger.error(
      {
        method: options.method,
        requestId: upstreamRequestId,
        route: options.upstreamPath,
        upstreamStatus: upstreamResponse.status,
      },
      'API proxy received 5xx response',
    );
  }

  const isJsonResponse = contentType.includes('application/json');
  const safeBody = options.sanitizeJson && isJsonResponse ? sanitizeJsonBody(body) : body;
  const response = BODYLESS_STATUS_CODES.has(upstreamResponse.status)
    ? new NextResponse(null, { status: upstreamResponse.status })
    : new NextResponse(safeBody, {
        status: upstreamResponse.status,
        headers: { 'Content-Type': contentType },
      });

  if (options.rotateSession && upstreamResponse.ok && isJsonResponse) {
    const sessionToken = readSessionToken(body);
    if (sessionToken) {
      applySessionCookies(response, sessionToken);
    }
  }

  response.headers.set('Cache-Control', 'no-store');
  return appendRequestId(response, upstreamRequestId);
}
