import { describe, expect, it } from 'vitest';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_INCOME_ENTRIES_PER_USER_MONTH,
  MAX_MONEY_AMOUNT,
} from './limits.ts';
import {
  createExpenseSchema,
  fxRateInputSchema,
  incomeAmountInputSchema,
  replaceIncomeEntriesSchema,
} from './schemas.ts';

const validIncomeEntry = {
  description: 'Salary',
  amount: 1,
  currencyCode: 'ARS',
};

const validExpense = {
  month: '2026-02',
  date: '2026-02-01',
  description: 'Groceries',
  categoryId: 'category-id',
  paidByUserId: 'user-id',
  amount: 10,
};

describe('public input bounds', () => {
  it('allows the maximum number of income entries', () => {
    const parsed = replaceIncomeEntriesSchema.safeParse({
      month: '2026-02',
      userId: 'user-id',
      entries: Array.from({ length: MAX_INCOME_ENTRIES_PER_USER_MONTH }, () => validIncomeEntry),
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects income entry arrays above the limit', () => {
    const parsed = replaceIncomeEntriesSchema.safeParse({
      month: '2026-02',
      userId: 'user-id',
      entries: Array.from(
        { length: MAX_INCOME_ENTRIES_PER_USER_MONTH + 1 },
        () => validIncomeEntry,
      ),
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toContain('entries');
  });

  it('rejects descriptions above the shared text limit', () => {
    const description = 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1);

    expect(createExpenseSchema.safeParse({ ...validExpense, description }).success).toBe(false);
    expect(
      replaceIncomeEntriesSchema.safeParse({
        month: '2026-02',
        userId: 'user-id',
        entries: [{ ...validIncomeEntry, description }],
      }).success,
    ).toBe(false);
  });

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'Infinity', '-Infinity'])(
    'rejects non-finite money input: %s',
    (amount) => {
      expect(incomeAmountInputSchema.safeParse(amount).success).toBe(false);
      expect(createExpenseSchema.safeParse({ ...validExpense, amount }).success).toBe(false);
    },
  );

  it('rejects values outside database decimal precision', () => {
    expect(incomeAmountInputSchema.safeParse(MAX_MONEY_AMOUNT).success).toBe(true);
    expect(incomeAmountInputSchema.safeParse(MAX_MONEY_AMOUNT + 1).success).toBe(false);
    expect(fxRateInputSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });
});
