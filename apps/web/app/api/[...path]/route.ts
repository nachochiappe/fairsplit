import { proxyMutation } from '../_lib/proxy';

type MutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type RouteContext = { params: Promise<{ path: string[] }> };

const ALLOWED_MUTATIONS: ReadonlyArray<readonly [MutationMethod, RegExp]> = [
  ['POST', /^\/expenses(?:\/materialize)?$/],
  ['POST', /^\/categories(?:\/[^/]+\/(?:archive|unarchive))?$/],
  ['POST', /^\/super-categories(?:\/[^/]+\/archive)?$/],
  ['POST', /^\/household\/(?:invites|join-with-code|skip-setup)$/],
  ['POST', /^\/auth\/passkeys\/registration\/(?:options|verify)$/],
  ['POST', /^\/integration-tokens$/],
  ['PUT', /^\/(?:incomes|exchange-rates|personal-budget)$/],
  ['PUT', /^\/household\/split-policy$/],
  ['PUT', /^\/expenses\/[^/]+$/],
  ['PUT', /^\/categories\/[^/]+(?:\/super-category)?$/],
  ['PUT', /^\/super-categories\/[^/]+$/],
  ['PATCH', /^\/users\/[^/]+$/],
  ['DELETE', /^\/expenses\/[^/]+$/],
  ['DELETE', /^\/auth\/passkeys\/[^/]+$/],
  ['DELETE', /^\/integration-tokens\/[^/]+$/],
];

async function handleMutation(
  request: Request,
  context: RouteContext,
  method: MutationMethod,
): Promise<Response> {
  const { path } = await context.params;
  const upstreamPath = `/${path.map(encodeURIComponent).join('/')}`;
  const allowed = ALLOWED_MUTATIONS.some(
    ([allowedMethod, pattern]) => allowedMethod === method && pattern.test(upstreamPath),
  );

  if (!allowed) {
    return Response.json({ error: 'Unsupported mutation route.' }, { status: 405 });
  }

  return proxyMutation(request, { upstreamPath, method });
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleMutation(request, context, 'POST');
}

export function PUT(request: Request, context: RouteContext): Promise<Response> {
  return handleMutation(request, context, 'PUT');
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleMutation(request, context, 'PATCH');
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleMutation(request, context, 'DELETE');
}
