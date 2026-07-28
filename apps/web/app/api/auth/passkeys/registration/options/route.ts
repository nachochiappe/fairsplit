import { proxyMutation } from '../../../../_lib/proxy';

export async function POST(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/auth/passkeys/registration/options',
    method: 'POST',
  });
}
