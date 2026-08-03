import { describe, expect, it } from 'vitest';
import { createExpenseFormDefaults, expenseSchema } from './expense-form';

describe('expense form defaults', () => {
  it('keeps a fresh ARS expense valid when advanced fields mount', () => {
    const defaults = createExpenseFormDefaults({
      categoryId: 'category-1',
      paidByUserId: 'user-1',
    });

    const result = expenseSchema.safeParse({
      ...defaults,
      amount: 36100,
      description: 'Havanna',
      fxRate: String(defaults.fxRate ?? ''),
    });

    expect(result.success).toBe(true);
    expect(defaults).toMatchObject({ currencyCode: 'ARS', fxRate: 1 });
  });
});
