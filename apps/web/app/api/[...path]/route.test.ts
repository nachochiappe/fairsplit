import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyMutation } = vi.hoisted(() => ({ proxyMutation: vi.fn() }));

vi.mock('../_lib/proxy', () => ({ proxyMutation }));

import { DELETE, PATCH, POST, PUT } from './route';

const handlers = { DELETE, PATCH, POST, PUT } as const;

const allowedMutations = [
  ['POST', 'expenses'],
  ['POST', 'expenses/materialize'],
  ['POST', 'categories'],
  ['POST', 'categories/category-id/archive'],
  ['POST', 'categories/category-id/unarchive'],
  ['POST', 'super-categories'],
  ['POST', 'super-categories/super-category-id/archive'],
  ['POST', 'household/invites'],
  ['POST', 'household/join-with-code'],
  ['POST', 'household/skip-setup'],
  ['POST', 'auth/passkeys/registration/options'],
  ['POST', 'auth/passkeys/registration/verify'],
  ['PUT', 'incomes'],
  ['PUT', 'exchange-rates'],
  ['PUT', 'personal-budget'],
  ['PUT', 'household/split-policy'],
  ['PUT', 'expenses/expense-id'],
  ['PUT', 'categories/category-id'],
  ['PUT', 'categories/category-id/super-category'],
  ['PUT', 'super-categories/super-category-id'],
  ['PATCH', 'users/user-id'],
  ['DELETE', 'expenses/expense-id'],
  ['DELETE', 'auth/passkeys/passkey-id'],
] as const;

describe('mutation proxy route', () => {
  beforeEach(() => {
    proxyMutation.mockReset();
  });

  it.each(allowedMutations)('forwards %s /%s through the authenticated proxy', async (method, path) => {
    const expectedResponse = Response.json({ ok: true });
    proxyMutation.mockResolvedValue(expectedResponse);
    const request = new Request(`http://localhost/api/${path}`, { method });

    await expect(
      handlers[method](request, { params: Promise.resolve({ path: path.split('/') }) }),
    ).resolves.toBe(expectedResponse);
    expect(proxyMutation).toHaveBeenCalledWith(request, {
      upstreamPath: `/${path}`,
      method,
    });
  });

  it('rejects routes and methods outside the allowlist', async () => {
    const request = new Request('http://localhost/api/auth/link', { method: 'PUT' });
    const response = await PUT(request, {
      params: Promise.resolve({ path: ['auth', 'link'] }),
    });

    expect(response.status).toBe(405);
    expect(proxyMutation).not.toHaveBeenCalled();
  });
});
