import { z } from 'zod';

export const supportedCurrencyCodes = ['ARS', 'USD', 'EUR'] as const;
export type SupportedCurrencyCode = (typeof supportedCurrencyCodes)[number];
export const currencyCodeSchema = z.enum(supportedCurrencyCodes);
export const DEFAULT_CURRENCY_CODE: SupportedCurrencyCode = 'ARS';

export function getTodayDateInputValue() {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

export function dateInputValueToMonth(value: string) {
  return value.slice(0, 7);
}

export function toSupportedCurrencyCode(value: string): SupportedCurrencyCode {
  const normalizedValue = value.trim().toUpperCase();
  return supportedCurrencyCodes.includes(normalizedValue as SupportedCurrencyCode)
    ? (normalizedValue as SupportedCurrencyCode)
    : DEFAULT_CURRENCY_CODE;
}

export function getDayFromDateInput(value: string): number | null {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.getDate();
}

export const expenseSchema = z
  .object({
    date: z.string().date(),
    description: z.string().min(1),
    categoryId: z.string().min(1),
    amount: z.coerce.number().min(0).optional(),
    currencyCode: currencyCodeSchema,
    fxRate: z.coerce.number().gt(0).optional(),
    paidByUserId: z.string().min(1),
    fixedEnabled: z.boolean().default(false),
    nextMonthExpense: z.boolean().default(false),
    applyToFuture: z.boolean().default(true),
    installmentEnabled: z.boolean().default(false),
    installmentCount: z.coerce.number().int().min(2).optional(),
    installmentEntryMode: z.enum(['perInstallment', 'total']).optional(),
    totalAmount: z.coerce.number().min(0).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.installmentEnabled && value.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount is required',
        path: ['amount'],
      });
    }

    if (!value.installmentEnabled) {
      return;
    }

    if (!value.installmentCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Installment count is required',
        path: ['installmentCount'],
      });
    }

    if (!value.installmentEntryMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Entry mode is required',
        path: ['installmentEntryMode'],
      });
      return;
    }

    if (value.installmentEntryMode === 'perInstallment' && value.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Per-installment amount is required',
        path: ['amount'],
      });
    }

    if (value.installmentEntryMode === 'total' && value.totalAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Total amount is required',
        path: ['totalAmount'],
      });
    }
  });

export type ExpenseForm = z.infer<typeof expenseSchema>;

interface CreateExpenseFormDefaultsOptions {
  categoryId: string;
  paidByUserId: string;
}

export function createExpenseFormDefaults({
  categoryId,
  paidByUserId,
}: CreateExpenseFormDefaultsOptions): ExpenseForm {
  return {
    date: getTodayDateInputValue(),
    description: '',
    categoryId,
    amount: undefined,
    currencyCode: DEFAULT_CURRENCY_CODE,
    fxRate: 1,
    paidByUserId,
    fixedEnabled: false,
    nextMonthExpense: false,
    applyToFuture: true,
    installmentEnabled: false,
    installmentCount: 2,
    installmentEntryMode: 'perInstallment',
    totalAmount: undefined,
  };
}
