import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FairsplitApiClient } from './api-client.js';
import { createFairsplitMcpServer } from './server.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createFairsplitMcpServer(
    new FairsplitApiClient('https://fairsplit.test/api', 'fsp_test'),
  );
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe('Fairsplit MCP server', () => {
  it('exposes read and write tools with destructive annotations', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { client, server } = await connectedClient();

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'get_household_context',
      'list_month',
      'create_income',
      'update_income',
      'delete_income',
      'create_expense',
      'update_expense',
      'delete_expense',
    ]);
    expect(tools.tools.find((tool) => tool.name === 'list_month')?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(
      tools.tools.find((tool) => tool.name === 'delete_expense')?.annotations?.destructiveHint,
    ).toBe(true);

    await client.close();
    await server.close();
  });

  it('resolves member and category names before creating an expense', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/users')) {
        return Response.json([{ id: 'user-1', name: 'Nacho' }]);
      }
      if (requestUrl.endsWith('/categories')) {
        return Response.json([
          { id: 'category-1', name: 'Groceries', archivedAt: null, superCategoryName: 'Home' },
        ]);
      }
      if (requestUrl.endsWith('/expenses') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({
          categoryId: 'category-1',
          paidByUserId: 'user-1',
          description: 'Weekly shop',
          amount: 500,
        });
        return Response.json({ id: 'expense-1', ...body }, { status: 201 });
      }
      return Response.json({ error: 'Unexpected request' }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { client, server } = await connectedClient();

    const result = await client.callTool({
      name: 'create_expense',
      arguments: {
        month: '2099-12',
        date: '2099-12-10',
        description: 'Weekly shop',
        category: 'groceries',
        amount: 500,
        paidBy: 'nacho',
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ expense: { id: 'expense-1' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await client.close();
    await server.close();
  });

  it('returns API failures as tool errors instead of protocol failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Invalid integration token.' }, { status: 401 })),
    );
    const { client, server } = await connectedClient();

    const result = await client.callTool({
      name: 'list_month',
      arguments: { month: '2099-12' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: 'Invalid integration token.',
      status: 401,
    });

    await client.close();
    await server.close();
  });
});
