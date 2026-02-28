import { proxyMutation } from '../../../_lib/proxy';

const REVALIDATE_PATHS = ['/settings', '/expenses', '/dashboard'] as const;

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Params): Promise<Response> {
  const { id } = await context.params;
  return proxyMutation(request, {
    upstreamPath: `/categories/${encodeURIComponent(id)}/archive`,
    method: 'POST',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
