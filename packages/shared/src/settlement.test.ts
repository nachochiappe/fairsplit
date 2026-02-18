import { describe, expect, it } from 'vitest';
import { calculateSettlement } from './settlement';

describe('calculateSettlement', () => {
  it('computes fair contribution and transfer for two users', () => {
    const result = calculateSettlement({
      incomesByUser: { a: '4000', b: '2000' },
      paidByUser: { a: '1000', b: '1500' },
    });

    expect(result.totalIncome).toBe('6000.00');
    expect(result.totalExpenses).toBe('2500.00');
    expect(result.fairShareByUser.a).toBe('1666.67');
    expect(result.fairShareByUser.b).toBe('833.33');
    expect(result.differenceByUser.a).toBe('-666.67');
    expect(result.differenceByUser.b).toBe('666.67');
    expect(result.transfer).toEqual({ fromUserId: 'a', toUserId: 'b', amount: '666.67' });
  });

  it('returns no transfer when balanced after rounding', () => {
    const result = calculateSettlement({
      incomesByUser: { a: '1000', b: '1000' },
      paidByUser: { a: '500', b: '500' },
    });

    expect(result.transfer).toBeNull();
  });

  it('handles zero income and zero expenses', () => {
    const result = calculateSettlement({
      incomesByUser: { a: '0', b: '0' },
      paidByUser: { a: '0', b: '0' },
    });

    expect(result.expenseRatio).toBe('0');
    expect(result.transfer).toBeNull();
  });

  it('throws when total income is non-positive and expenses are present', () => {
    expect(() =>
      calculateSettlement({
        incomesByUser: { a: '-10', b: '0' },
        paidByUser: { a: '50', b: '0' },
      }),
    ).toThrow('Cannot calculate settlement');
  });
});
