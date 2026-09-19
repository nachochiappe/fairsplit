import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '../../../lib/session';
import { appendRequestId, getOrCreateRequestId, withRequestId } from '../../../lib/request-id';
import { webLogger } from '../../../lib/server-logger';
import { forwardApiResponse } from '../_lib/proxy-response';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';
const ALLOWED_READ_PATH_PREFIXES = [
  '/users',
  '/months',
  '/incomes',
  '/expenses',
  '/expense-description-suggestions',
  '/categories',
  '/super-categories',
  '/exchange-rates',
  '/settlement',
  '/personal-budget',
  '/household/setup-status',
  '/household/split-policy',
  '/auth/passkeys',
  '/integration-tokens',
] as const;

function isAllowedPath(path: string): boolean {
  return ALLOWED_READ_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`),
  );
}

export async function GET(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(new Headers(request.headers));
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return appendRequestId(
      Response.json({ error: 'Missing authentication context.' }, { status: 401 }),
      requestId,
    );
  }

  const requestUrl = new URL(request.url);
  const upstreamPath = requestUrl.searchParams.get('path')?.trim() ?? '';
  if (
    !upstreamPath ||
    !upstreamPath.startsWith('/') ||
    upstreamPath.startsWith('//') ||
    !isAllowedPath(upstreamPath)
  ) {
    return appendRequestId(
      Response.json({ error: 'Invalid read path.' }, { status: 400 }),
      requestId,
    );
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
    return appendRequestId(
      Response.json({ error: 'Failed to reach API.' }, { status: 502 }),
      requestId,
    );
  }

  return forwardApiResponse(upstreamResponse, {
    method: 'GET',
    requestId,
    upstreamPath,
  });
}
