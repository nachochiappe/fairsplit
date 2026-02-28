import { proxyMutation } from '../_lib/proxy';

const REVALIDATE_PATHS = ['/expenses', '/dashboard', '/incomes'] as const;

export async function PUT(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/exchange-rates',
    method: 'PUT',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
