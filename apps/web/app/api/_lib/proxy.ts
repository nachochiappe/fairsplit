import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../../lib/session';
import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../../lib/request-id';
import { webLogger } from '../../../lib/server-logger';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

interface ProxyMutationOptions {
  upstreamPath: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  revalidatePaths?: string[];
}

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

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }
  return origin === new URL(request.url).origin;
}

export async function proxyMutation(request: Request, options: ProxyMutationOptions): Promise<Response> {
  const requestId = getOrCreateRequestId(new Headers(request.headers));
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return appendRequestId(Response.json({ error: 'Missing authentication context.' }, { status: 401 }), requestId);
  }
  if (!isSameOrigin(request)) {
    webLogger.warn(
      {
        method: options.method,
        requestId,
        route: options.upstreamPath,
      },
      'Rejected mutation with invalid request origin',
    );
    return appendRequestId(Response.json({ error: 'Invalid request origin.' }, { status: 403 }), requestId);
  }

  const csrfCookie = cookieStore.get(CSRF_COOKIE)?.value;
  const csrfHeader = request.headers.get('x-fairsplit-csrf')?.trim();
  if (!csrfCookie || !csrfHeader || csrfHeader !== csrfCookie) {
    webLogger.warn(
      {
        method: options.method,
        requestId,
        route: options.upstreamPath,
      },
      'Rejected mutation with invalid CSRF token',
    );
    return appendRequestId(Response.json({ error: 'Invalid CSRF token.' }, { status: 403 }), requestId);
  }

  const rawBody = await request.text();
  const contentType = request.headers.get('content-type') ?? 'application/json';
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(`${API_BASE_URL}${options.upstreamPath}`, {
      method: options.method,
      headers: withRequestId(
        {
          'Content-Type': contentType,
          'x-fairsplit-session': sessionToken,
        },
        requestId,
      ),
      body: rawBody.length > 0 ? rawBody : undefined,
      cache: 'no-store',
    });
  } catch (error) {
    webLogger.error(
      {
        err: error,
        method: options.method,
        requestId,
        route: options.upstreamPath,
      },
      'Mutation proxy failed to reach API',
    );
    return appendRequestId(Response.json({ error: 'Failed to reach API.' }, { status: 502 }), requestId);
  }

  const responseBody = await upstreamResponse.text();
  const contentTypeHeader = upstreamResponse.headers.get('content-type') ?? 'application/json';
  const upstreamRequestId = upstreamResponse.headers.get(REQUEST_ID_HEADER) ?? requestId;
  if (upstreamResponse.status >= 500) {
    webLogger.error(
      {
        method: options.method,
        requestId: upstreamRequestId,
        route: options.upstreamPath,
        upstreamStatus: upstreamResponse.status,
      },
      'Mutation proxy received API 5xx response',
    );
  }
  if (upstreamResponse.ok) {
    for (const path of options.revalidatePaths ?? []) {
      revalidatePath(path);
    }
  }
  const isJsonResponse = contentTypeHeader.includes('application/json');
  const safeBody = isJsonResponse ? sanitizeJsonBody(responseBody) : responseBody;
  const response = new NextResponse(safeBody, {
    status: upstreamResponse.status,
    headers: { 'Content-Type': contentTypeHeader },
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

  response.headers.set('Content-Type', contentTypeHeader);
  response.headers.set('Cache-Control', 'no-store');
  return appendRequestId(response, upstreamRequestId);
}
