import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../lib/session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

interface ProxyMutationOptions {
  upstreamPath: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  revalidatePaths?: string[];
}

export async function proxyMutation(request: Request, options: ProxyMutationOptions): Promise<Response> {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return Response.json({ error: 'Missing authentication context.' }, { status: 401 });
  }

  const rawBody = await request.text();
  const contentType = request.headers.get('content-type') ?? 'application/json';
  const upstreamResponse = await fetch(`${API_BASE_URL}${options.upstreamPath}`, {
    method: options.method,
    headers: {
      'Content-Type': contentType,
      'x-fairsplit-session': sessionToken,
    },
    body: rawBody.length > 0 ? rawBody : undefined,
    cache: 'no-store',
  });

  const responseBody = await upstreamResponse.text();
  const contentTypeHeader = upstreamResponse.headers.get('content-type') ?? 'application/json';
  if (upstreamResponse.ok) {
    for (const path of options.revalidatePaths ?? []) {
      revalidatePath(path);
    }
  }
  const response = new NextResponse(responseBody, {
    status: upstreamResponse.status,
    headers: { 'Content-Type': contentTypeHeader },
  });

  if (upstreamResponse.ok && contentTypeHeader.includes('application/json')) {
    try {
      const parsed = JSON.parse(responseBody) as { sessionToken?: unknown };
      if (typeof parsed.sessionToken === 'string' && parsed.sessionToken.length > 0) {
        response.cookies.set({
          name: SESSION_COOKIE,
          value: parsed.sessionToken,
          path: '/',
          maxAge: 60 * 60 * 24 * 30,
          sameSite: 'lax',
        });
      }
    } catch {
      // Ignore non-JSON response bodies.
    }
  }

  return response;
}
