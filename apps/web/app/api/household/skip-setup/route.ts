import { proxyMutation } from '../../_lib/proxy';

const REVALIDATE_PATHS = ['/dashboard', '/incomes', '/expenses', '/settings', '/onboarding/household'] as const;

export async function POST(request: Request): Promise<Response> {
  return proxyMutation(request, {
    upstreamPath: '/household/skip-setup',
    method: 'POST',
    revalidatePaths: [...REVALIDATE_PATHS],
  });
}
