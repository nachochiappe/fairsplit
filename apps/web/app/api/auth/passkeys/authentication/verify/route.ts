import { proxyPasskeyLoginStep } from '../../_lib/login-proxy';

export async function POST(request: Request): Promise<Response> {
  return proxyPasskeyLoginStep(request, '/auth/passkeys/authentication/verify');
}
