"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateExpenseSchema = exports.createExpenseSchema = exports.installmentInputSchema = exports.applyScopeSchema = exports.replaceIncomeEntriesSchema = exports.userSchema = exports.incomeAmountInputSchema = exports.moneyInputSchema = exports.monthSchema = void 0;
const zod_1 = require("zod");
exports.monthSchema = zod_1.z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format');
exports.moneyInputSchema = zod_1.z.coerce.number().min(0, 'amount must be >= 0');
exports.incomeAmountInputSchema = zod_1.z.coerce.number();
const optionalMoneyInputSchema = zod_1.z.preprocess((value) => (value === undefined || value === null || value === '' ? undefined : value), exports.moneyInputSchema.optional());
exports.userSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string().min(1),
    createdAt: zod_1.z.string(),
});
exports.replaceIncomeEntriesSchema = zod_1.z.object({
    month: exports.monthSchema,
    userId: zod_1.z.string(),
    amounts: zod_1.z.array(exports.incomeAmountInputSchema),
});
exports.applyScopeSchema = zod_1.z.enum(['single', 'future', 'all']);
exports.installmentInputSchema = zod_1.z
    .object({
    enabled: zod_1.z.boolean(),
    count: zod_1.z.coerce.number().int().min(2).optional(),
    entryMode: zod_1.z.enum(['perInstallment', 'total']).optional(),
    perInstallmentAmount: optionalMoneyInputSchema,
    totalAmount: optionalMoneyInputSchema,
})
    .superRefine((value, ctx) => {
    if (!value.enabled) {
        return;
    }
    if (!value.count) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'installment.count is required when installments are enabled',
            path: ['count'],
        });
    }
    if (!value.entryMode) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'installment.entryMode is required when installments are enabled',
            path: ['entryMode'],
        });
        return;
    }
    if (value.entryMode === 'perInstallment' && value.perInstallmentAmount === undefined) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'installment.perInstallmentAmount is required for perInstallment entry mode',
            path: ['perInstallmentAmount'],
        });
    }
    if (value.entryMode === 'total' && value.totalAmount === undefined) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'installment.totalAmount is required for total entry mode',
            path: ['totalAmount'],
        });
    }
});
const createExpenseBaseSchema = zod_1.z.object({
    month: exports.monthSchema,
    date: zod_1.z.string().date(),
    description: zod_1.z.string().min(1),
    category: zod_1.z.string().min(1),
    amount: optionalMoneyInputSchema,
    paidByUserId: zod_1.z.string(),
    installment: exports.installmentInputSchema.optional(),
});
exports.createExpenseSchema = createExpenseBaseSchema.superRefine((value, ctx) => {
    if (!value.installment?.enabled && value.amount === undefined) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'amount is required when installment is disabled',
            path: ['amount'],
        });
    }
    if (value.installment?.enabled && value.installment.entryMode === 'perInstallment') {
        const payloadAmount = value.installment.perInstallmentAmount ?? value.amount;
        if (payloadAmount === undefined) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'per-installment amount is required',
                path: ['installment', 'perInstallmentAmount'],
            });
        }
    }
});
exports.updateExpenseSchema = createExpenseBaseSchema
    .partial()
    .extend({
    month: exports.monthSchema.optional(),
    date: zod_1.z.string().date().optional(),
    description: zod_1.z.string().min(1).optional(),
    category: zod_1.z.string().min(1).optional(),
    amount: optionalMoneyInputSchema,
    paidByUserId: zod_1.z.string().optional(),
    installment: exports.installmentInputSchema.optional(),
    applyScope: exports.applyScopeSchema.optional(),
})
    .superRefine((value, ctx) => {
    if (value.installment?.enabled && value.installment.entryMode === 'perInstallment') {
        const payloadAmount = value.installment.perInstallmentAmount ?? value.amount;
        if (payloadAmount === undefined) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'per-installment amount is required',
                path: ['installment', 'perInstallmentAmount'],
            });
        }
    }
});
