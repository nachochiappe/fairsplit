import { proxyMutation } from '../../../../_lib/proxy';

const REVALIDATE_PATHS = ['/settings'] as const;

export async function POST(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/auth/passkeys/registration/verify',
    method: 'POST',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
