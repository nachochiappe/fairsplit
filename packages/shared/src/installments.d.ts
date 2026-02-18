export type InstallmentEntryMode = 'perInstallment' | 'total';
export interface InstallmentScheduleInput {
    count: number;
    entryMode: InstallmentEntryMode;
    perInstallmentAmount?: string | number;
    totalAmount?: string | number;
}
export interface InstallmentScheduleOutput {
    amounts: string[];
    totalAmount: string;
}
export declare function addMonths(month: string, offset: number): string;
export declare function monthToDate(month: string, day: number): Date;
export declare function monthDiff(startMonth: string, endMonth: string): number;
export declare function computeInstallmentAmounts(input: InstallmentScheduleInput): InstallmentScheduleOutput;
