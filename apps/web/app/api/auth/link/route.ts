import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../../../lib/request-id';
import { webLogger } from '../../../../lib/server-logger';
import { applySessionCookies, readSessionToken, sanitizeJsonBody } from '../../_lib/auth-cookies';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

export async function POST(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(new Headers(request.headers));
  const contentType = request.headers.get('content-type') ?? 'application/json';
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(`${API_BASE_URL}/auth/link`, {
      method: 'POST',
      headers: withRequestId(
        {
          'Content-Type': contentType,
        },
        requestId,
      ),
      body: await request.text(),
      cache: 'no-store',
    });
  } catch (error) {
    webLogger.error(
      {
        err: error,
        method: 'POST',
        requestId,
        route: '/auth/link',
      },
      'Auth link route failed to reach API',
    );
    return appendRequestId(Response.json({ error: 'Failed to reach API.' }, { status: 502 }), requestId);
  }

  const responseBody = await upstreamResponse.text();
  const contentTypeHeader = upstreamResponse.headers.get('content-type') ?? 'application/json';
  const upstreamRequestId = upstreamResponse.headers.get(REQUEST_ID_HEADER) ?? requestId;
  if (upstreamResponse.status >= 500) {
    webLogger.error(
      {
        method: 'POST',
        requestId: upstreamRequestId,
        route: '/auth/link',
        upstreamStatus: upstreamResponse.status,
      },
      'Auth link route received API 5xx response',
    );
  }
  const isJsonResponse = contentTypeHeader.includes('application/json');
  const safeBody = isJsonResponse ? sanitizeJsonBody(responseBody) : responseBody;
  const response = new NextResponse(safeBody, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': contentTypeHeader,
      'Cache-Control': 'no-store',
    },
  });

  if (upstreamResponse.ok && isJsonResponse) {
    const sessionToken = readSessionToken(responseBody);
    if (sessionToken) {
      applySessionCookies(response, sessionToken);
    }
  }

  return appendRequestId(response, upstreamRequestId);
}
