import { proxyMutation } from '../../_lib/proxy';

const REVALIDATE_PATHS = ['/settings', '/expenses', '/dashboard'] as const;

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, context: Params): Promise<Response> {
  const { id } = await context.params;
  return proxyMutation(request, {
    upstreamPath: `/categories/${encodeURIComponent(id)}`,
    method: 'PUT',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
