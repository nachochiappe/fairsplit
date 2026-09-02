import Decimal from 'decimal.js';
import { addMonths } from '@fairsplit/shared';

export type PersonalBudgetConfidence = 'none' | 'low' | 'medium' | 'high';

export interface PersonalBudgetForecastInput {
  month: string;
  monthlyIncome: Decimal.Value;
  currentSharedExpenses: Decimal.Value;
  historicalSharedExpenses: Decimal.Value[];
  splitPercentage: Decimal.Value;
  alreadyPaid: Decimal.Value;
  fixedCommitments: Decimal.Value;
  savingsTarget: Decimal.Value;
  safetyBuffer: Decimal.Value;
  historyMonthsRequested: number;
}

export interface PersonalBudgetForecast {
  month: string;
  monthlyIncome: string;
  historicalAverageSharedExpenses: string;
  projectedSharedExpenses: string;
  splitPercentage: string;
  projectedFairShare: string;
  alreadyPaid: string;
  remainingSharedReserve: string;
  fixedCommitments: string;
  savingsTarget: string;
  safetyBuffer: string;
  availableForPersonalUse: string;
  historyMonthsRequested: number;
  historyMonthsUsed: number;
  confidence: PersonalBudgetConfidence;
}

const zero = new Decimal(0);

function nonNegative(value: Decimal.Value): Decimal {
  return Decimal.max(zero, new Decimal(value));
}

export function previousMonths(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addMonths(month, -(index + 1)));
}

export function calculatePersonalBudgetForecast(input: PersonalBudgetForecastInput): PersonalBudgetForecast {
  const historical = input.historicalSharedExpenses.map(nonNegative);
  const historyMonthsUsed = historical.length;
  const historicalAverage =
    historyMonthsUsed === 0 ? zero : historical.reduce((sum, value) => sum.plus(value), zero).div(historyMonthsUsed);
  const currentSharedExpenses = nonNegative(input.currentSharedExpenses);
  const projectedSharedExpenses = Decimal.max(currentSharedExpenses, historicalAverage);
  const splitPercentage = Decimal.min(100, nonNegative(input.splitPercentage));
  const projectedFairShare = projectedSharedExpenses.mul(splitPercentage).div(100);
  const alreadyPaid = new Decimal(input.alreadyPaid);
  const remainingSharedReserve = Decimal.max(zero, projectedFairShare.minus(alreadyPaid));
  const monthlyIncome = new Decimal(input.monthlyIncome);
  const fixedCommitments = nonNegative(input.fixedCommitments);
  const savingsTarget = nonNegative(input.savingsTarget);
  const safetyBuffer = nonNegative(input.safetyBuffer);
  const availableForPersonalUse = monthlyIncome
    .minus(projectedFairShare)
    .minus(fixedCommitments)
    .minus(savingsTarget)
    .minus(safetyBuffer);

  let confidence: PersonalBudgetConfidence = 'none';
  if (historyMonthsUsed >= input.historyMonthsRequested) {
    confidence = 'high';
  } else if (historyMonthsUsed >= Math.min(3, input.historyMonthsRequested)) {
    confidence = 'medium';
  } else if (historyMonthsUsed > 0) {
    confidence = 'low';
  }

  return {
    month: input.month,
    monthlyIncome: monthlyIncome.toFixed(2),
    historicalAverageSharedExpenses: historicalAverage.toFixed(2),
    projectedSharedExpenses: projectedSharedExpenses.toFixed(2),
    splitPercentage: splitPercentage.toFixed(2),
    projectedFairShare: projectedFairShare.toFixed(2),
    alreadyPaid: alreadyPaid.toFixed(2),
    remainingSharedReserve: remainingSharedReserve.toFixed(2),
    fixedCommitments: fixedCommitments.toFixed(2),
    savingsTarget: savingsTarget.toFixed(2),
    safetyBuffer: safetyBuffer.toFixed(2),
    availableForPersonalUse: availableForPersonalUse.toFixed(2),
    historyMonthsRequested: input.historyMonthsRequested,
    historyMonthsUsed,
    confidence,
  };
}
