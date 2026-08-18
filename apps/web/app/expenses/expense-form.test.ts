import { describe, expect, it } from 'vitest';
import { MAX_INSTALLMENT_COUNT } from '@fairsplit/shared';
import {
  createExpenseFormDefaults,
  expenseSchema,
  resolveInstallmentTotalAmountOnEnable,
} from './expense-form';

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

  it('rejects non-finite amounts and oversized installment schedules', () => {
    const defaults = createExpenseFormDefaults({
      categoryId: 'category-1',
      paidByUserId: 'user-1',
    });

    expect(
      expenseSchema.safeParse({
        ...defaults,
        amount: 'Infinity',
        description: 'Laptop',
      }).success,
    ).toBe(false);

    expect(
      expenseSchema.safeParse({
        ...defaults,
        amount: 100,
        description: 'Laptop',
        installmentEnabled: true,
        installmentCount: MAX_INSTALLMENT_COUNT + 1,
        installmentEntryMode: 'perInstallment',
      }).success,
    ).toBe(false);
  });
});

describe('resolveInstallmentTotalAmountOnEnable', () => {
  it('preserves the entered amount when enabling total-amount installments', () => {
    expect(
      resolveInstallmentTotalAmountOnEnable({
        amount: 123.45,
        installmentEntryMode: 'total',
        totalAmount: undefined,
      }),
    ).toBe(123.45);
  });

  it('does not overwrite an existing total amount', () => {
    expect(
      resolveInstallmentTotalAmountOnEnable({
        amount: 123.45,
        installmentEntryMode: 'total',
        totalAmount: 200,
      }),
    ).toBe(200);
  });
});
