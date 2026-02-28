import { proxyMutation } from '../_lib/proxy';

const REVALIDATE_PATHS = ['/settings', '/expenses', '/dashboard'] as const;

export async function POST(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/categories',
    method: 'POST',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
