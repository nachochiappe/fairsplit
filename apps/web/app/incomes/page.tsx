import { IncomesClient } from './IncomesClient';
import { getExchangeRates, getIncomes, getUsers } from '../../lib/api';

interface IncomesPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_CACHE = { next: { revalidate: 15 } } as const;

export default async function IncomesPage({ searchParams }: IncomesPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? new Date().toISOString().slice(0, 7);
  const [users, incomes, exchangeRates] = await Promise.all([
    getUsers(SERVER_READ_CACHE),
    getIncomes(month, SERVER_READ_CACHE),
    getExchangeRates(month, SERVER_READ_CACHE),
  ]);

  return <IncomesClient month={month} initialUsers={users} initialIncomes={incomes} initialExchangeRates={exchangeRates} />;
}
