import { Expense, ExpenseListResponse, ExchangeRate } from '../../lib/api';

export type ExpenseSectionKey = 'fixed' | 'oneTime' | 'installment';

export interface SectionPaginationState {
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number | null;
}

export type SectionPaginationMap = Record<ExpenseSectionKey, SectionPaginationState>;

export interface ExpenseFilterState {
  searchQuery: string;
  categoryId: string;
}

export interface ExpenseScreenSnapshot {
  expenses: Expense[];
  warnings: string[];
  subtotalTotals: ExpenseListResponse['totals'];
  totalCombinedExpensesArs: number;
  sectionPagination: SectionPaginationMap;
  exchangeRates: ExchangeRate[];
}

export function mergeUniqueExpenses(expenses: Expense[]): Expense[] {
  const dedupedById = new Map<string, Expense>();
  for (const expense of expenses) {
    dedupedById.set(expense.id, expense);
  }
  return Array.from(dedupedById.values());
}

export function getExpenseSectionKey(expense: Expense): ExpenseSectionKey {
  if (expense.fixed.enabled) {
    return 'fixed';
  }
  if (expense.installment) {
    return 'installment';
  }
  return 'oneTime';
}

export function matchesExpenseFilters(expense: Expense, filters: ExpenseFilterState): boolean {
  if (filters.categoryId !== 'all' && expense.categoryId !== filters.categoryId) {
    return false;
  }

  const searchTerm = filters.searchQuery.trim().toLowerCase();
  if (!searchTerm) {
    return true;
  }

  const searchableText = `${expense.description} ${expense.categoryName} ${expense.paidByUserName}`.toLowerCase();
  return searchableText.includes(searchTerm);
}

export function sumExpensesArs(expenses: Expense[]): number {
  return expenses.reduce((sum, expense) => sum + Number(expense.amountArs), 0);
}

export function cloneSectionPaginationMap(sectionPagination: SectionPaginationMap): SectionPaginationMap {
  return {
    fixed: { ...sectionPagination.fixed },
    oneTime: { ...sectionPagination.oneTime },
    installment: { ...sectionPagination.installment },
  };
}

export function createExpenseScreenSnapshot(input: ExpenseScreenSnapshot): ExpenseScreenSnapshot {
  return {
    expenses: [...input.expenses],
    warnings: [...input.warnings],
    subtotalTotals: input.subtotalTotals
      ? {
          filteredSubtotalArs: input.subtotalTotals.filteredSubtotalArs,
          bySection: {
            fixedArs: input.subtotalTotals.bySection.fixedArs,
            oneTimeArs: input.subtotalTotals.bySection.oneTimeArs,
            installmentArs: input.subtotalTotals.bySection.installmentArs,
          },
        }
      : null,
    totalCombinedExpensesArs: input.totalCombinedExpensesArs,
    sectionPagination: cloneSectionPaginationMap(input.sectionPagination),
    exchangeRates: [...input.exchangeRates],
  };
}

export function replaceExpense(expenses: Expense[], expenseId: string, nextExpense: Expense): Expense[] {
  return mergeUniqueExpenses(expenses.map((expense) => (expense.id === expenseId ? nextExpense : expense)));
}

export function patchExpense(
  expenses: Expense[],
  expenseId: string,
  patcher: (expense: Expense) => Expense,
): { expenses: Expense[]; previousAffected: Expense[]; nextAffected: Expense[] } {
  const previousAffected = expenses.filter((expense) => expense.id === expenseId);
  const nextExpenses = expenses.map((expense) => (expense.id === expenseId ? patcher(expense) : expense));
  return {
    expenses: mergeUniqueExpenses(nextExpenses),
    previousAffected,
    nextAffected: nextExpenses.filter((expense) => expense.id === expenseId),
  };
}

export function patchExpenses(
  expenses: Expense[],
  predicate: (expense: Expense) => boolean,
  patcher: (expense: Expense) => Expense,
): { expenses: Expense[]; previousAffected: Expense[]; nextAffected: Expense[] } {
  const previousAffected = expenses.filter(predicate);
  const nextExpenses = expenses.map((expense) => (predicate(expense) ? patcher(expense) : expense));
  return {
    expenses: mergeUniqueExpenses(nextExpenses),
    previousAffected,
    nextAffected: nextExpenses.filter(predicate),
  };
}

export function insertExpense(
  expenses: Expense[],
  expense: Expense,
): { expenses: Expense[]; previousAffected: Expense[]; nextAffected: Expense[] } {
  return {
    expenses: mergeUniqueExpenses([expense, ...expenses]),
    previousAffected: [],
    nextAffected: [expense],
  };
}

export function removeExpenseById(
  expenses: Expense[],
  expenseId: string,
): { expenses: Expense[]; previousAffected: Expense[]; nextAffected: Expense[] } {
  const previousAffected = expenses.filter((expense) => expense.id === expenseId);
  return {
    expenses: expenses.filter((expense) => expense.id !== expenseId),
    previousAffected,
    nextAffected: [],
  };
}

export function removeExpenses(
  expenses: Expense[],
  predicate: (expense: Expense) => boolean,
): { expenses: Expense[]; previousAffected: Expense[]; nextAffected: Expense[] } {
  const previousAffected = expenses.filter(predicate);
  return {
    expenses: expenses.filter((expense) => !predicate(expense)),
    previousAffected,
    nextAffected: [],
  };
}

function toMoneyString(value: number): string {
  return value.toFixed(2);
}

export function adjustTotalCombinedExpensesArs(
  currentTotal: number,
  previousAffected: Expense[],
  nextAffected: Expense[],
): number {
  return currentTotal + sumExpensesArs(nextAffected) - sumExpensesArs(previousAffected);
}

export function adjustSubtotalTotals(
  currentTotals: ExpenseListResponse['totals'],
  previousAffected: Expense[],
  nextAffected: Expense[],
  filters: ExpenseFilterState,
): ExpenseListResponse['totals'] {
  if (!currentTotals) {
    return currentTotals;
  }

  const previousMatching = previousAffected.filter((expense) => matchesExpenseFilters(expense, filters));
  const nextMatching = nextAffected.filter((expense) => matchesExpenseFilters(expense, filters));
  const filteredDelta = sumExpensesArs(nextMatching) - sumExpensesArs(previousMatching);

  const sectionDelta = (sectionKey: ExpenseSectionKey) =>
    sumExpensesArs(nextMatching.filter((expense) => getExpenseSectionKey(expense) === sectionKey)) -
    sumExpensesArs(previousMatching.filter((expense) => getExpenseSectionKey(expense) === sectionKey));

  return {
    filteredSubtotalArs: toMoneyString(Number(currentTotals.filteredSubtotalArs) + filteredDelta),
    bySection: {
      fixedArs: toMoneyString(Number(currentTotals.bySection.fixedArs) + sectionDelta('fixed')),
      oneTimeArs: toMoneyString(Number(currentTotals.bySection.oneTimeArs) + sectionDelta('oneTime')),
      installmentArs: toMoneyString(Number(currentTotals.bySection.installmentArs) + sectionDelta('installment')),
    },
  };
}

export function adjustSectionPagination(
  currentPagination: SectionPaginationMap,
  previousAffected: Expense[],
  nextAffected: Expense[],
): SectionPaginationMap {
  const nextPagination = cloneSectionPaginationMap(currentPagination);
  const sectionKeys: ExpenseSectionKey[] = ['fixed', 'oneTime', 'installment'];

  for (const sectionKey of sectionKeys) {
    const previousCount = previousAffected.filter((expense) => getExpenseSectionKey(expense) === sectionKey).length;
    const nextCount = nextAffected.filter((expense) => getExpenseSectionKey(expense) === sectionKey).length;
    if (previousCount === nextCount || nextPagination[sectionKey].totalCount === null) {
      continue;
    }

    nextPagination[sectionKey] = {
      ...nextPagination[sectionKey],
      totalCount: Math.max(0, (nextPagination[sectionKey].totalCount ?? 0) + nextCount - previousCount),
    };
  }

  return nextPagination;
}
