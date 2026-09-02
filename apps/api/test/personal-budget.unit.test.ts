import { describe, expect, it } from 'vitest';
import { calculatePersonalBudgetForecast, previousMonths } from '../src/lib/personal-budget';

describe('personal budget forecast', () => {
  it('deducts the full projected fair share from the whole-month personal allowance', () => {
    const forecast = calculatePersonalBudgetForecast({
      month: '2026-09',
      monthlyIncome: '2500000',
      currentSharedExpenses: '900000',
      historicalSharedExpenses: ['1200000', '1100000', '1300000'],
      splitPercentage: '60',
      alreadyPaid: '300000',
      fixedCommitments: '280000',
      savingsTarget: '200000',
      safetyBuffer: '100000',
      historyMonthsRequested: 3,
    });

    expect(forecast).toMatchObject({
      historicalAverageSharedExpenses: '1200000.00',
      projectedSharedExpenses: '1200000.00',
      projectedFairShare: '720000.00',
      remainingSharedReserve: '420000.00',
      availableForPersonalUse: '1200000.00',
      confidence: 'high',
    });
  });

  it('uses current shared spending when it has already exceeded the historical baseline', () => {
    const forecast = calculatePersonalBudgetForecast({
      month: '2026-09',
      monthlyIncome: '1000',
      currentSharedExpenses: '900',
      historicalSharedExpenses: ['600', '750'],
      splitPercentage: '50',
      alreadyPaid: '100',
      fixedCommitments: '100',
      savingsTarget: '100',
      safetyBuffer: '50',
      historyMonthsRequested: 3,
    });

    expect(forecast.projectedSharedExpenses).toBe('900.00');
    expect(forecast.remainingSharedReserve).toBe('350.00');
    expect(forecast.availableForPersonalUse).toBe('300.00');
    expect(forecast.confidence).toBe('low');
  });

  it('exposes a shortfall instead of hiding it at zero', () => {
    const forecast = calculatePersonalBudgetForecast({
      month: '2026-09',
      monthlyIncome: '500',
      currentSharedExpenses: '1000',
      historicalSharedExpenses: [],
      splitPercentage: '50',
      alreadyPaid: '0',
      fixedCommitments: '200',
      savingsTarget: '100',
      safetyBuffer: '50',
      historyMonthsRequested: 3,
    });

    expect(forecast.availableForPersonalUse).toBe('-350.00');
    expect(forecast.confidence).toBe('none');
  });

  it('builds the requested completed-month window across year boundaries', () => {
    expect(previousMonths('2026-02', 3)).toEqual(['2026-01', '2025-12', '2025-11']);
  });
});
