import { DashboardClient } from './DashboardClient';
import {
  getExpenses,
  getIncomes,
  getSettlement,
  getUsers,
  type Expense,
  type Income,
  type SettlementResponse,
  type User,
} from '../../lib/api';

interface DashboardPageProps {
  searchParams?: Promise<{ month?: string }>;
}

interface ExpenseCategorySlice {
  categoryName: string;
  totalArs: number;
  superCategoryName: string | null;
  superCategoryColor: string | null;
}

const SERVER_READ_CACHE = { next: { revalidate: 60 } } as const;

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? new Date().toISOString().slice(0, 7);
  let users: User[] = [];
  let incomes: Income[] = [];
  let settlementResult: SettlementResponse | null = null;
  let expensesResult: Expense[] = [];

  try {
    [users, incomes, settlementResult, expensesResult] = await Promise.all([
      getUsers(SERVER_READ_CACHE),
      getIncomes(month, SERVER_READ_CACHE),
      getSettlement(month, SERVER_READ_CACHE, { hydrate: false }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to load settlement';
        if (message.includes('Cannot calculate settlement when total income is non-positive')) {
          return null;
        }

        throw error;
      }),
      getExpenses(month, undefined, SERVER_READ_CACHE).then((result) => result.expenses),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to connect to API';
    const settlement = buildNoIncomeSettlement(month, [], [], []);
    return (
      <DashboardClient
        month={month}
        users={[]}
        settlement={settlement}
        incomes={[]}
        warning={`Backend is unavailable. ${message}`}
      />
    );
  }

  let settlement: SettlementResponse;
  let warning: string | null = null;

  if (settlementResult) {
    settlement = settlementResult;
  } else {
    settlement = buildNoIncomeSettlement(month, users, incomes, expensesResult);
    warning = 'No incomes are set for this month yet. Add incomes to calculate a fair settlement.';
  }

  return (
    <DashboardClient
      month={month}
      users={users}
      settlement={settlement}
      incomes={incomes}
      warning={warning}
      expenseCategorySlices={buildExpenseCategorySlices(expensesResult)}
    />
  );
}

function buildNoIncomeSettlement(
  month: string,
  users: User[],
  incomes: Income[],
  expenses: Expense[],
): SettlementResponse {
  const paidByUser: Record<string, number> = {};
  const incomeByUser: Record<string, number> = {};

  for (const user of users) {
    paidByUser[user.id] = 0;
    incomeByUser[user.id] = 0;
  }

  for (const income of incomes) {
    incomeByUser[income.userId] = (incomeByUser[income.userId] ?? 0) + Number(income.amountArs);
  }

  for (const expense of expenses) {
    paidByUser[expense.paidByUserId] = (paidByUser[expense.paidByUserId] ?? 0) + Number(expense.amountArs);
  }

  const totalIncome = Object.values(incomeByUser).reduce((sum, value) => sum + value, 0);
  const totalExpenses = Object.values(paidByUser).reduce((sum, value) => sum + value, 0);

  const toMoney = (value: number): string => value.toFixed(2);

  return {
    month,
    totalIncome: toMoney(totalIncome),
    totalExpenses: toMoney(totalExpenses),
    expenseRatio: totalIncome === 0 ? '0' : (totalExpenses / totalIncome).toFixed(6),
    fairShareByUser: Object.fromEntries(users.map((user) => [user.id, '0.00'])),
    paidByUser: Object.fromEntries(users.map((user) => [user.id, toMoney(paidByUser[user.id] ?? 0)])),
    differenceByUser: Object.fromEntries(users.map((user) => [user.id, toMoney(paidByUser[user.id] ?? 0)])),
    transfer: null,
  };
}

function buildExpenseCategorySlices(expenses: Expense[]): ExpenseCategorySlice[] {
  const totals = new Map<string, ExpenseCategorySlice>();

  for (const expense of expenses) {
    const existing = totals.get(expense.categoryName);
    if (!existing) {
      totals.set(expense.categoryName, {
        categoryName: expense.categoryName,
        totalArs: Number(expense.amountArs),
        superCategoryName: expense.superCategoryName,
        superCategoryColor: expense.superCategoryColor,
      });
      continue;
    }

    existing.totalArs += Number(expense.amountArs);
  }

  return Array.from(totals.entries())
    .map(([, slice]) => slice)
    .filter((entry) => entry.totalArs > 0)
    .sort((a, b) => b.totalArs - a.totalArs);
}
