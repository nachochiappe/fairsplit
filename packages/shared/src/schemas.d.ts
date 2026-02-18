import { z } from 'zod';
export declare const monthSchema: z.ZodString;
export declare const moneyInputSchema: z.ZodNumber;
export declare const incomeAmountInputSchema: z.ZodNumber;
export declare const userSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    createdAt: string;
}, {
    id: string;
    name: string;
    createdAt: string;
}>;
export declare const replaceIncomeEntriesSchema: z.ZodObject<any>;
export declare const applyScopeSchema: z.ZodEnum<["single", "future", "all"]>;
export declare const installmentInputSchema: z.ZodEffects<z.ZodObject<any>, any, any>;
export declare const createExpenseSchema: z.ZodEffects<z.ZodObject<any>, any, any>;
export declare const updateExpenseSchema: z.ZodEffects<z.ZodObject<any>, any, any>;
export type ReplaceIncomeEntriesInput = z.infer<typeof replaceIncomeEntriesSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type InstallmentInput = z.infer<typeof installmentInputSchema>;
export type ApplyScope = z.infer<typeof applyScopeSchema>;
