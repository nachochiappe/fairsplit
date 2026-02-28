import { proxyMutation } from '../../_lib/proxy';

const REVALIDATE_PATHS = ['/settings'] as const;

export async function POST(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/household/invites',
    method: 'POST',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
