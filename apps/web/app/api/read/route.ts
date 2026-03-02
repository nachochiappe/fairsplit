import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../lib/session';

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
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return Response.json({ error: 'Missing authentication context.' }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const upstreamPath = requestUrl.searchParams.get('path')?.trim() ?? '';
  if (!upstreamPath || !upstreamPath.startsWith('/') || upstreamPath.startsWith('//') || !isAllowedPath(upstreamPath)) {
    return Response.json({ error: 'Invalid read path.' }, { status: 400 });
  }

  const upstreamResponse = await fetch(`${API_BASE_URL}${upstreamPath}`, {
    method: 'GET',
    headers: {
      'x-fairsplit-session': sessionToken,
    },
    cache: 'no-store',
  });

  const body = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json';
  return new NextResponse(body, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
}
