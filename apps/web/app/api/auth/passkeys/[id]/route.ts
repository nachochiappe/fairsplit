import { proxyMutation } from '../../../_lib/proxy';

const REVALIDATE_PATHS = ['/settings'] as const;

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, context: Params): Promise<Response> {
  const { id } = await context.params;
  return proxyMutation(request, {
    upstreamPath: `/auth/passkeys/${encodeURIComponent(id)}`,
    method: 'DELETE',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
