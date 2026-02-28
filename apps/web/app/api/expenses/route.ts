import { proxyMutation } from '../_lib/proxy';

const REVALIDATE_PATHS = ['/expenses', '/dashboard'] as const;

export async function POST(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/expenses',
    method: 'POST',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
