import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '@fairsplit/logging';
import { SESSION_COOKIE } from '../../../lib/session';
import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../../lib/request-id';
import { webLogger } from '../../../lib/server-logger';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';
const ALLOWED_READ_PATH_PREFIXES = [
  '/users',
  '/months',
  '/incomes',
  '/expenses',
  '/categories',
  '/super-categories',
  '/exchange-rates',
  '/settlement',
  '/household/setup-status',
] as const;

function isAllowedPath(path: string): boolean {
  return ALLOWED_READ_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`));
}

export async function GET(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(new Headers(request.headers));
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return appendRequestId(Response.json({ error: 'Missing authentication context.' }, { status: 401 }), requestId);
  }

  const requestUrl = new URL(request.url);
  const upstreamPath = requestUrl.searchParams.get('path')?.trim() ?? '';
  if (!upstreamPath || !upstreamPath.startsWith('/') || upstreamPath.startsWith('//') || !isAllowedPath(upstreamPath)) {
    return appendRequestId(Response.json({ error: 'Invalid read path.' }, { status: 400 }), requestId);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(`${API_BASE_URL}${upstreamPath}`, {
      method: 'GET',
      headers: withRequestId(
        {
          'x-fairsplit-session': sessionToken,
        },
        requestId,
      ),
      cache: 'no-store',
    });
  } catch (error) {
    webLogger.error(
      {
        err: error,
        method: 'GET',
        requestId,
        route: upstreamPath,
      },
      'Read proxy failed to reach API',
    );
    return appendRequestId(Response.json({ error: 'Failed to reach API.' }, { status: 502 }), requestId);
  }

  const body = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json';
  const upstreamRequestId = upstreamResponse.headers.get(REQUEST_ID_HEADER) ?? requestId;
  if (upstreamResponse.status >= 500) {
    webLogger.error(
      {
        method: 'GET',
        requestId: upstreamRequestId,
        route: upstreamPath,
        upstreamStatus: upstreamResponse.status,
      },
      'Read proxy received API 5xx response',
    );
  }
  return appendRequestId(
    new NextResponse(body, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
    }),
    upstreamRequestId,
  );
}
