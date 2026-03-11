import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../../../lib/session';
import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../../../lib/request-id';
import { webLogger } from '../../../../lib/server-logger';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

function sanitizeJsonBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { sessionToken?: unknown };
    if (Object.prototype.hasOwnProperty.call(parsed, 'sessionToken')) {
      delete parsed.sessionToken;
      return JSON.stringify(parsed);
    }
    return body;
  } catch {
    return body;
  }
}

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
    try {
      const parsed = JSON.parse(responseBody) as { sessionToken?: unknown };
      if (typeof parsed.sessionToken === 'string' && parsed.sessionToken.length > 0) {
        response.cookies.set({
          name: SESSION_COOKIE,
          value: parsed.sessionToken,
          path: '/',
          maxAge: SESSION_MAX_AGE_SECONDS,
          sameSite: 'lax',
          secure: secureCookies(),
          httpOnly: true,
        });
        response.cookies.set({
          name: CSRF_COOKIE,
          value: generateCsrfToken(),
          path: '/',
          maxAge: SESSION_MAX_AGE_SECONDS,
          sameSite: 'lax',
          secure: secureCookies(),
          httpOnly: false,
        });
      }
    } catch {
      // Ignore non-JSON response bodies.
    }
  }

  return appendRequestId(response, upstreamRequestId);
}
