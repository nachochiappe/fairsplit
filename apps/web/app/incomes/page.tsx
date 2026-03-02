import { cookies } from 'next/headers';
import { IncomesClient } from './IncomesClient';
import { getExchangeRates, getIncomes, getUsers } from '../../lib/api';
import { SESSION_COOKIE } from '../../lib/session';

interface IncomesPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_CACHE = { next: { revalidate: 60 } } as const;

export default async function IncomesPage({ searchParams }: IncomesPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? new Date().toISOString().slice(0, 7);
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const serverReadInit = sessionToken
    ? ({ ...SERVER_READ_CACHE, headers: { 'x-fairsplit-session': sessionToken } } as const)
    : SERVER_READ_CACHE;

  const [users, incomes, exchangeRates] = await Promise.all([
    getUsers(serverReadInit),
    getIncomes(month, serverReadInit),
    getExchangeRates(month, serverReadInit),
  ]);

  return <IncomesClient month={month} initialUsers={users} initialIncomes={incomes} initialExchangeRates={exchangeRates} />;
}
