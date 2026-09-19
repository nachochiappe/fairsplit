import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  FairsplitApiClient,
  FairsplitApiError,
  resolveNamedEntity,
  type Category,
  type HouseholdUser,
} from './api-client.js';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.');
const date = z.iso.date();
const currencyCode = z.enum(['ARS', 'USD', 'EUR']);
const money = z.number().finite().min(-999_999_999_999.99).max(999_999_999_999.99);
const positiveFxRate = z.number().finite().positive().max(999_999_999.999999);
const entityReference = z.string().trim().min(1);
const applyScope = z.enum(['single', 'future', 'all']);

type LookupContext = { users: HouseholdUser[]; categories: Category[] };

function success(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function failure(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : 'Unexpected Fairsplit error.';
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: {
      error: message,
      ...(error instanceof FairsplitApiError
        ? { status: error.status, details: error.details }
        : {}),
    },
  };
}

async function run(handler: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    return success(await handler());
  } catch (error) {
    return failure(error);
  }
}

export function createFairsplitMcpServer(client: FairsplitApiClient): McpServer {
  const server = new McpServer(
    { name: 'fairsplit', version: '0.1.0' },
    {
      instructions:
        'Use get_household_context before creating transactions when member or category ids are unknown. Use list_month before updates or deletions to identify the exact transaction id. Never guess ids, member names, categories, dates, amounts, currencies, or recurring/installment scope.',
    },
  );

  const getLookupContext = async (): Promise<LookupContext> => {
    const [users, categories] = await Promise.all([client.listUsers(), client.listCategories()]);
    return { users, categories };
  };

  server.registerTool(
    'get_household_context',
    {
      title: 'Get household context',
      description:
        'List household members and active expense categories, including the ids accepted by write tools.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      run(async () => {
        const context = await getLookupContext();
        return {
          users: context.users.map(({ id, name }) => ({ id, name })),
          categories: context.categories
            .filter((category) => category.archivedAt === null)
            .map(({ id, name, superCategoryName }) => ({ id, name, superCategoryName })),
        };
      }),
  );

  server.registerTool(
    'list_month',
    {
      title: 'List a Fairsplit month',
      description: 'Return all expenses and income entries recorded for one YYYY-MM month.',
      inputSchema: z.object({ month: month.describe('Month in YYYY-MM format.') }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ month: selectedMonth }) =>
      run(async () => {
        const [expenseResult, incomes] = await Promise.all([
          client.listExpenses(selectedMonth),
          client.listIncomes(selectedMonth),
        ]);
        return {
          month: selectedMonth,
          expenses: expenseResult.expenses,
          incomes,
          warnings: expenseResult.warnings,
        };
      }),
  );

  server.registerTool(
    'create_income',
    {
      title: 'Create income',
      description: 'Create one income entry for a household member in a given month.',
      inputSchema: z.object({
        month: month.describe('Month in YYYY-MM format.'),
        user: entityReference.describe('Exact household member name or id.'),
        description: z.string().trim().min(1).max(200),
        amount: money,
        currencyCode: currencyCode.default('ARS'),
        fxRate: positiveFxRate
          .optional()
          .describe('Rate to ARS. Required when no monthly rate exists.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) =>
      run(async () => {
        const user = resolveNamedEntity(await client.listUsers(), input.user, 'household member');
        const income = await client.createIncome({
          month: input.month,
          userId: user.id,
          description: input.description,
          amount: input.amount,
          currencyCode: input.currencyCode,
          ...(input.fxRate !== undefined ? { fxRate: input.fxRate } : {}),
        });
        return { income };
      }),
  );

  server.registerTool(
    'update_income',
    {
      title: 'Update income',
      description: 'Update one income entry by id. Call list_month first when the id is unknown.',
      inputSchema: z
        .object({
          id: entityReference.describe('Income id from list_month.'),
          month: month.optional(),
          user: entityReference.optional().describe('Exact household member name or id.'),
          description: z.string().trim().min(1).max(200).optional(),
          amount: money.optional(),
          currencyCode: currencyCode.optional(),
          fxRate: positiveFxRate.optional(),
        })
        .refine((value) => Object.keys(value).some((key) => key !== 'id'), {
          message: 'Provide at least one field to update.',
        }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input) =>
      run(async () => {
        const { id, user: userReference, ...changes } = input;
        let userId: string | undefined;
        if (userReference) {
          userId = resolveNamedEntity(
            await client.listUsers(),
            userReference,
            'household member',
          ).id;
        }
        const income = await client.updateIncome(id, {
          ...changes,
          ...(userId ? { userId } : {}),
        });
        return { income };
      }),
  );

  server.registerTool(
    'delete_income',
    {
      title: 'Delete income',
      description:
        'Permanently delete one income entry by id. Call list_month first when the id is unknown.',
      inputSchema: z.object({ id: entityReference.describe('Income id from list_month.') }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ id }) =>
      run(async () => {
        await client.deleteIncome(id);
        return { deleted: true, id };
      }),
  );

  const installmentSchema = z.object({
    enabled: z.literal(true),
    count: z.number().int().min(2).max(120),
    entryMode: z.enum(['perInstallment', 'total']),
    perInstallmentAmount: money.optional(),
    totalAmount: money.optional(),
  });

  server.registerTool(
    'create_expense',
    {
      title: 'Create expense',
      description: 'Create one ordinary, recurring, or installment expense for a given month.',
      inputSchema: z
        .object({
          month: month.describe('Month in YYYY-MM format.'),
          date: date.describe('Expense date in YYYY-MM-DD format; it should fall within month.'),
          description: z.string().trim().min(1).max(200),
          category: entityReference.describe('Exact active category name or id.'),
          amount: money.optional().describe('Required for ordinary and recurring expenses.'),
          currencyCode: currencyCode.default('ARS'),
          fxRate: positiveFxRate
            .optional()
            .describe('Rate to ARS. Required when no monthly rate exists.'),
          paidBy: entityReference.describe('Exact household member name or id.'),
          fixed: z
            .boolean()
            .default(false)
            .describe('Create a recurring monthly expense template.'),
          installment: installmentSchema.optional(),
        })
        .superRefine((value, context) => {
          if (!value.date.startsWith(`${value.month}-`)) {
            context.addIssue({
              code: 'custom',
              path: ['date'],
              message: 'date must fall within month.',
            });
          }
          if (value.fixed && value.installment) {
            context.addIssue({
              code: 'custom',
              path: ['fixed'],
              message: 'A fixed expense cannot be an installment.',
            });
          }
          if (!value.installment && value.amount === undefined) {
            context.addIssue({ code: 'custom', path: ['amount'], message: 'amount is required.' });
          }
          if (
            value.installment?.entryMode === 'perInstallment' &&
            value.installment.perInstallmentAmount === undefined
          ) {
            context.addIssue({
              code: 'custom',
              path: ['installment', 'perInstallmentAmount'],
              message: 'perInstallmentAmount is required for perInstallment mode.',
            });
          }
          if (
            value.installment?.entryMode === 'total' &&
            value.installment.totalAmount === undefined
          ) {
            context.addIssue({
              code: 'custom',
              path: ['installment', 'totalAmount'],
              message: 'totalAmount is required for total mode.',
            });
          }
        }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) =>
      run(async () => {
        const { users, categories } = await getLookupContext();
        const paidByUser = resolveNamedEntity(users, input.paidBy, 'household member');
        const category = resolveNamedEntity(
          categories.filter((candidate) => candidate.archivedAt === null),
          input.category,
          'active category',
        );
        const expense = await client.createExpense({
          month: input.month,
          date: input.date,
          description: input.description,
          categoryId: category.id,
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          currencyCode: input.currencyCode,
          ...(input.fxRate !== undefined ? { fxRate: input.fxRate } : {}),
          paidByUserId: paidByUser.id,
          fixed: { enabled: input.fixed },
          ...(input.installment ? { installment: input.installment } : {}),
        });
        return { expense };
      }),
  );

  server.registerTool(
    'update_expense',
    {
      title: 'Update expense',
      description:
        'Update one expense by id. For recurring expenses, applyToFuture updates later months too.',
      inputSchema: z
        .object({
          id: entityReference.describe('Expense id from list_month.'),
          month: month.optional(),
          date: date.optional(),
          description: z.string().trim().min(1).max(200).optional(),
          category: entityReference.optional().describe('Exact active category name or id.'),
          amount: money.optional(),
          currencyCode: currencyCode.optional(),
          fxRate: positiveFxRate.optional(),
          paidBy: entityReference.optional().describe('Exact household member name or id.'),
          applyScope: applyScope
            .optional()
            .describe('For installments: update one, future, or all occurrences.'),
          applyToFuture: z
            .boolean()
            .optional()
            .describe('For recurring expenses: update future generated months.'),
        })
        .refine((value) => Object.keys(value).some((key) => key !== 'id'), {
          message: 'Provide at least one field to update.',
        }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input) =>
      run(async () => {
        const { id, category: categoryReference, paidBy: paidByReference, ...changes } = input;
        const payload: Record<string, unknown> = { ...changes };
        if (categoryReference || paidByReference) {
          const { users, categories } = await getLookupContext();
          if (categoryReference) {
            payload.categoryId = resolveNamedEntity(
              categories.filter((candidate) => candidate.archivedAt === null),
              categoryReference,
              'active category',
            ).id;
          }
          if (paidByReference) {
            payload.paidByUserId = resolveNamedEntity(
              users,
              paidByReference,
              'household member',
            ).id;
          }
        }
        const expense = await client.updateExpense(id, payload);
        return { expense };
      }),
  );

  server.registerTool(
    'delete_expense',
    {
      title: 'Delete expense',
      description:
        'Delete one expense. Recurring and installment expenses may require an explicit scope.',
      inputSchema: z.object({
        id: entityReference.describe('Expense id from list_month.'),
        applyScope: applyScope
          .optional()
          .describe('Delete one, future, or all recurring/installment occurrences.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ id, applyScope: scope }) =>
      run(async () => {
        await client.deleteExpense(id, scope);
        return { deleted: true, id, ...(scope ? { applyScope: scope } : {}) };
      }),
  );

  return server;
}
