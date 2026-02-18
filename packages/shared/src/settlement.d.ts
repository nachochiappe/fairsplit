import Decimal from 'decimal.js';
export interface SettlementInput {
    incomesByUser: Record<string, Decimal.Value>;
    paidByUser: Record<string, Decimal.Value>;
}
export interface SettlementOutput {
    totalIncome: string;
    totalExpenses: string;
    expenseRatio: string;
    fairShareByUser: Record<string, string>;
    paidByUser: Record<string, string>;
    differenceByUser: Record<string, string>;
    transfer: null | {
        fromUserId: string;
        toUserId: string;
        amount: string;
    };
}
export declare function calculateSettlement(input: SettlementInput): SettlementOutput;
