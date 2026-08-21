import { proxyMutation } from '../../_lib/proxy';

const REVALIDATE_PATHS = ['/settings', '/dashboard'] as const;

export async function PUT(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/household/split-policy',
    method: 'PUT',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
