import { ExpensesClient } from './ExpensesClient';
import { Expense, getCategories, getExchangeRates, getExpenses, getSettlement, getUsers } from '../../lib/api';
import { DEFAULT_MAX_ROWS_PER_SECTION, getSectionFetchBatchSize } from './pagination';

interface ExpensesPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_CACHE = { next: { revalidate: 60 } } as const;
const INITIAL_EXPENSES_PAGE_SIZE = getSectionFetchBatchSize(DEFAULT_MAX_ROWS_PER_SECTION);
const NO_INCOME_SETTLEMENT_ERROR = 'Cannot calculate settlement when total income is non-positive';
const NO_INCOME_WARNING = 'No incomes are set for this month yet. Add incomes to calculate a fair settlement.';

function mergeUniqueExpenses(expenses: Expense[]): Expense[] {
  const dedupedById = new Map<string, Expense>();
  for (const expense of expenses) {
    dedupedById.set(expense.id, expense);
  }
  return Array.from(dedupedById.values());
}

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? new Date().toISOString().slice(0, 7);
  const users = await getUsers(SERVER_READ_CACHE);
  const fixedData = await getExpenses(
    month,
    { type: 'fixed', sortBy: 'date', sortDir: 'desc', limit: INITIAL_EXPENSES_PAGE_SIZE, hydrate: true, includeCount: true },
    SERVER_READ_CACHE,
  );
  const oneTimeData = await getExpenses(
    month,
    { type: 'oneTime', sortBy: 'date', sortDir: 'desc', limit: INITIAL_EXPENSES_PAGE_SIZE, hydrate: false, includeCount: false },
    SERVER_READ_CACHE,
  );
  const installmentData = await getExpenses(
    month,
    {
      type: 'installment',
      sortBy: 'date',
      sortDir: 'desc',
      limit: INITIAL_EXPENSES_PAGE_SIZE,
      hydrate: false,
      includeCount: false,
    },
    SERVER_READ_CACHE,
  );
  const totalsData = await getExpenses(
    month,
    {
      sortBy: 'date',
      sortDir: 'desc',
      limit: 1,
      hydrate: false,
      includeCount: false,
      includeTotals: true,
    },
    SERVER_READ_CACHE,
  );
  const categories = await getCategories(SERVER_READ_CACHE);
  const exchangeRates = await getExchangeRates(month, SERVER_READ_CACHE);
  let totalExpensesArs = '0.00';
  let noIncomeWarning: string | null = null;

  try {
    const settlement = await getSettlement(month, SERVER_READ_CACHE, { hydrate: false });
    totalExpensesArs = settlement.totalExpenses;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load settlement';
    if (!message.includes(NO_INCOME_SETTLEMENT_ERROR)) {
      throw error;
    }

    noIncomeWarning = NO_INCOME_WARNING;
    const allExpensesForMonth = await getExpenses(
      month,
      { sortBy: 'date', sortDir: 'desc', hydrate: false, includeCount: false },
      SERVER_READ_CACHE,
    );
    const total = allExpensesForMonth.expenses.reduce((sum, expense) => sum + Number(expense.amountArs), 0);
    totalExpensesArs = total.toFixed(2);
  }

  const initialWarnings = Array.from(
    new Set([
      ...fixedData.warnings,
      ...oneTimeData.warnings,
      ...installmentData.warnings,
      ...(noIncomeWarning ? [noIncomeWarning] : []),
    ]),
  );

  return (
    <ExpensesClient
      month={month}
      initialUsers={users}
      initialExpenses={mergeUniqueExpenses([...fixedData.expenses, ...oneTimeData.expenses, ...installmentData.expenses])}
      initialWarnings={initialWarnings}
      initialSectionPagination={{
        fixed: {
          nextCursor: fixedData.pagination?.nextCursor ?? null,
          hasMore: fixedData.pagination?.hasMore ?? false,
          totalCount: fixedData.pagination?.totalCount ?? null,
        },
        oneTime: {
          nextCursor: oneTimeData.pagination?.nextCursor ?? null,
          hasMore: oneTimeData.pagination?.hasMore ?? false,
          totalCount: oneTimeData.pagination?.totalCount ?? null,
        },
        installment: {
          nextCursor: installmentData.pagination?.nextCursor ?? null,
          hasMore: installmentData.pagination?.hasMore ?? false,
          totalCount: installmentData.pagination?.totalCount ?? null,
        },
      }}
      initialCategories={categories}
      initialExchangeRates={exchangeRates}
      initialTotalExpensesArs={totalExpensesArs}
      initialTotals={totalsData.totals}
    />
  );
}
