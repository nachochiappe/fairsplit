import { proxyMutation } from '../_lib/proxy';

export async function PUT(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/personal-budget',
    method: 'PUT',
    revalidatePaths: ['/dashboard'],
  });
}
