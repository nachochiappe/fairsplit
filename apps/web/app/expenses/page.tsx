import { ExpensesClient } from './ExpensesClient';
import { getCategories, getExchangeRates, getExpenses, getUsers } from '../../lib/api';

interface ExpensesPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_CACHE = { next: { revalidate: 15 } } as const;
const INITIAL_EXPENSES_PAGE_SIZE = 30;

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? new Date().toISOString().slice(0, 7);
  const [users, expenseData, categories, exchangeRates] = await Promise.all([
    getUsers(SERVER_READ_CACHE),
    getExpenses(month, { limit: INITIAL_EXPENSES_PAGE_SIZE }, SERVER_READ_CACHE),
    getCategories(SERVER_READ_CACHE),
    getExchangeRates(month, SERVER_READ_CACHE),
  ]);

  return (
    <ExpensesClient
      month={month}
      initialUsers={users}
      initialExpenses={expenseData.expenses}
      initialWarnings={expenseData.warnings}
      initialPagination={expenseData.pagination}
      initialCategories={categories}
      initialExchangeRates={exchangeRates}
    />
  );
}
