import { proxyMutation } from '../../_lib/proxy';

const REVALIDATE_PATHS = ['/settings', '/dashboard', '/expenses', '/incomes'] as const;

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: Params): Promise<Response> {
  const { id } = await context.params;
  return proxyMutation(request, {
    upstreamPath: `/users/${encodeURIComponent(id)}`,
    method: 'PATCH',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
