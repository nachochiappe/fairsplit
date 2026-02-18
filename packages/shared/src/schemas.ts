import { z } from 'zod';

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format');

export const moneyInputSchema = z.coerce.number().min(0, 'amount must be >= 0');
export const fxRateInputSchema = z.coerce.number().gt(0, 'fxRate must be > 0');
export const incomeAmountInputSchema = z.coerce.number();
export const expenseAmountInputSchema = z.coerce.number();
const optionalExpenseAmountInputSchema = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  expenseAmountInputSchema.optional(),
);
const optionalFxRateInputSchema = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  fxRateInputSchema.optional(),
);
export const supportedCurrencyCodes = ['ARS', 'USD', 'EUR'] as const;
export type SupportedCurrencyCode = (typeof supportedCurrencyCodes)[number];
export const currencyCodeSchema = z.string().trim().toUpperCase().pipe(z.enum(supportedCurrencyCodes));

export const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string(),
});

export const replaceIncomeEntriesSchema = z.object({
  month: monthSchema,
  userId: z.string(),
  entries: z.array(
    z.object({
      description: z.string().trim().min(1, 'description is required'),
      amount: incomeAmountInputSchema,
      currencyCode: currencyCodeSchema.default('ARS'),
      fxRate: optionalFxRateInputSchema,
    }),
  ),
});

export const applyScopeSchema = z.enum(['single', 'future', 'all']);

export const installmentInputSchema = z
  .object({
    enabled: z.boolean(),
    count: z.coerce.number().int().min(2).optional(),
    entryMode: z.enum(['perInstallment', 'total']).optional(),
    perInstallmentAmount: optionalExpenseAmountInputSchema,
    totalAmount: optionalExpenseAmountInputSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) {
      return;
    }

    if (!value.count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'installment.count is required when installments are enabled',
        path: ['count'],
      });
    }

    if (!value.entryMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'installment.entryMode is required when installments are enabled',
        path: ['entryMode'],
      });
      return;
    }

    if (value.entryMode === 'perInstallment' && value.perInstallmentAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'installment.perInstallmentAmount is required for perInstallment entry mode',
        path: ['perInstallmentAmount'],
      });
    }

    if (value.entryMode === 'total' && value.totalAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'installment.totalAmount is required for total entry mode',
        path: ['totalAmount'],
      });
    }
  });

const createExpenseBaseSchema = z.object({
  month: monthSchema,
  date: z.string().date(),
  description: z.string().min(1),
  categoryId: z.string().min(1),
  amount: optionalExpenseAmountInputSchema,
  currencyCode: currencyCodeSchema.default('ARS'),
  fxRate: optionalFxRateInputSchema,
  paidByUserId: z.string(),
  fixed: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  installment: installmentInputSchema.optional(),
});

export const createExpenseSchema = createExpenseBaseSchema.superRefine((value, ctx) => {
    if (value.fixed?.enabled && value.installment?.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fixed expenses cannot be installments',
        path: ['fixed', 'enabled'],
      });
    }

    if (!value.installment?.enabled && value.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'amount is required when installment is disabled',
        path: ['amount'],
      });
    }

    if (value.installment?.enabled && value.installment.entryMode === 'perInstallment') {
      const payloadAmount = value.installment.perInstallmentAmount ?? value.amount;
      if (payloadAmount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'per-installment amount is required',
          path: ['installment', 'perInstallmentAmount'],
        });
      }
    }
  });

export const updateExpenseSchema = createExpenseBaseSchema
  .partial()
  .extend({
    month: monthSchema.optional(),
    date: z.string().date().optional(),
    description: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    amount: optionalExpenseAmountInputSchema,
    currencyCode: currencyCodeSchema.optional(),
    fxRate: optionalFxRateInputSchema,
    paidByUserId: z.string().optional(),
    fixed: z
      .object({
        enabled: z.boolean(),
      })
      .optional(),
    installment: installmentInputSchema.optional(),
    applyScope: applyScopeSchema.optional(),
    applyToFuture: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.fixed?.enabled && value.installment?.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fixed expenses cannot be installments',
        path: ['fixed', 'enabled'],
      });
    }

    if (value.installment?.enabled && value.installment.entryMode === 'perInstallment') {
      const payloadAmount = value.installment.perInstallmentAmount ?? value.amount;
      if (payloadAmount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'per-installment amount is required',
          path: ['installment', 'perInstallmentAmount'],
        });
      }
    }
  });

export type ReplaceIncomeEntriesInput = z.infer<typeof replaceIncomeEntriesSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type InstallmentInput = z.infer<typeof installmentInputSchema>;
export type ApplyScope = z.infer<typeof applyScopeSchema>;
