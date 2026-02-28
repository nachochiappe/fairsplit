import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';
const SESSION_COOKIE = 'fairsplit_session';

function parseSessionCookie(rawValue: string | undefined): { userId: string | null } {
  if (!rawValue) {
    return { userId: null };
  }

  try {
    const decoded = decodeURIComponent(rawValue);
    const parsed = JSON.parse(decoded) as { userId?: unknown };
    return {
      userId: typeof parsed.userId === 'string' && parsed.userId.trim().length > 0 ? parsed.userId : null,
    };
  } catch {
    return { userId: null };
  }
}

interface ProxyMutationOptions {
  upstreamPath: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  revalidatePaths?: string[];
}

export async function proxyMutation(request: Request, options: ProxyMutationOptions): Promise<Response> {
  const sessionCookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = parseSessionCookie(sessionCookie);
  if (!session.userId) {
    return Response.json({ error: 'Missing authentication context.' }, { status: 401 });
  }

  const rawBody = await request.text();
  const contentType = request.headers.get('content-type') ?? 'application/json';
  const upstreamResponse = await fetch(`${API_BASE_URL}${options.upstreamPath}`, {
    method: options.method,
    headers: {
      'Content-Type': contentType,
      'x-fairsplit-user-id': session.userId,
    },
    body: rawBody.length > 0 ? rawBody : undefined,
    cache: 'no-store',
  });

  const responseBody = await upstreamResponse.text();
  if (upstreamResponse.ok) {
    for (const path of options.revalidatePaths ?? []) {
      revalidatePath(path);
    }
  }

  return new Response(responseBody, {
    status: upstreamResponse.status,
    headers: { 'Content-Type': upstreamResponse.headers.get('content-type') ?? 'application/json' },
  });
}
