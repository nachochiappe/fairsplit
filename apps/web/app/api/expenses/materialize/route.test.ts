import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyMutation } = vi.hoisted(() => ({ proxyMutation: vi.fn() }));

vi.mock('../../_lib/proxy', () => ({ proxyMutation }));

import { POST } from './route';

describe('POST /api/expenses/materialize', () => {
  beforeEach(() => {
    proxyMutation.mockReset();
  });

  it('uses the CSRF- and same-origin-enforcing mutation proxy', async () => {
    const expectedResponse = Response.json({ month: '2099-01', warnings: [] });
    proxyMutation.mockResolvedValue(expectedResponse);
    const request = new Request('http://localhost/api/expenses/materialize', {
      method: 'POST',
      body: JSON.stringify({ month: '2099-01' }),
    });

    await expect(POST(request)).resolves.toBe(expectedResponse);
    expect(proxyMutation).toHaveBeenCalledWith(request, {
      upstreamPath: '/expenses/materialize',
      method: 'POST',
      revalidatePaths: ['/expenses', '/dashboard'],
    });
  });
});
