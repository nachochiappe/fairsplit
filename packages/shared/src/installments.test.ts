import { describe, expect, it } from 'vitest';
import { addMonths, computeInstallmentAmounts, monthDiff } from './installments.ts';
import { createExpenseSchema } from './schemas.ts';
import { MAX_INSTALLMENT_COUNT } from './limits.ts';

describe('computeInstallmentAmounts', () => {
  it('builds per-installment schedule', () => {
    const result = computeInstallmentAmounts({
      count: 3,
      entryMode: 'perInstallment',
      perInstallmentAmount: 10,
    });

    expect(result.amounts).toEqual(['10.00', '10.00', '10.00']);
    expect(result.totalAmount).toBe('30.00');
  });

  it('adjusts last installment when total cannot divide evenly', () => {
    const result = computeInstallmentAmounts({
      count: 3,
      entryMode: 'total',
      totalAmount: 100,
    });

    expect(result.amounts).toEqual(['33.33', '33.33', '33.34']);
    expect(result.totalAmount).toBe('100.00');
  });

  it('allows the maximum supported installment count', () => {
    const result = computeInstallmentAmounts({
      count: MAX_INSTALLMENT_COUNT,
      entryMode: 'perInstallment',
      perInstallmentAmount: 1,
    });

    expect(result.amounts).toHaveLength(MAX_INSTALLMENT_COUNT);
  });

  it('rejects counts above the limit before allocating a schedule', () => {
    expect(() =>
      computeInstallmentAmounts({
        count: MAX_INSTALLMENT_COUNT + 1,
        entryMode: 'perInstallment',
        perInstallmentAmount: 1,
      }),
    ).toThrow(`between 1 and ${MAX_INSTALLMENT_COUNT}`);
  });

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'Infinity', 'not-money'])(
    'rejects a non-finite or invalid amount: %s',
    (amount) => {
      expect(() =>
        computeInstallmentAmounts({
          count: 2,
          entryMode: 'total',
          totalAmount: amount,
        }),
      ).toThrow(/finite amount/);
    },
  );
});

describe('month helpers', () => {
  it('computes month offsets', () => {
    expect(addMonths('2026-02', 1)).toBe('2026-03');
    expect(monthDiff('2026-02', '2026-05')).toBe(3);
  });
});

describe('createExpenseSchema installment validation', () => {
  it('requires amount when installment is disabled', () => {
    const parsed = createExpenseSchema.safeParse({
      month: '2026-02',
      date: '2026-02-01',
      description: 'Test',
      categoryId: 'category-id',
      paidByUserId: 'user-id',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toContain('amount');
  });

  it('accepts installment payload with total mode', () => {
    const parsed = createExpenseSchema.safeParse({
      month: '2026-02',
      date: '2026-02-01',
      description: 'Phone',
      categoryId: 'category-id',
      paidByUserId: 'user-id',
      installment: {
        enabled: true,
        count: 18,
        entryMode: 'total',
        totalAmount: 900,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects installment counts above the shared limit', () => {
    const parsed = createExpenseSchema.safeParse({
      month: '2026-02',
      date: '2026-02-01',
      description: 'Phone',
      categoryId: 'category-id',
      paidByUserId: 'user-id',
      installment: {
        enabled: true,
        count: MAX_INSTALLMENT_COUNT + 1,
        entryMode: 'total',
        totalAmount: 900,
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toContain(
      'installment.count',
    );
  });
});
