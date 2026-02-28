import { proxyMutation } from '../_lib/proxy';

const REVALIDATE_PATHS = ['/incomes', '/dashboard', '/expenses'] as const;

export async function PUT(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/incomes',
    method: 'PUT',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
