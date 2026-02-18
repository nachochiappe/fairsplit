import { describe, expect, it } from 'vitest';
import { addMonths, computeInstallmentAmounts, monthDiff } from './installments.ts';
import { createExpenseSchema } from './schemas.ts';

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
      category: 'Test',
      paidByUserId: 'user-id',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts installment payload with total mode', () => {
    const parsed = createExpenseSchema.safeParse({
      month: '2026-02',
      date: '2026-02-01',
      description: 'Phone',
      category: 'Tech',
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
});
