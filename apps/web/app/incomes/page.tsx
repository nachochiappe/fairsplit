import { cookies } from 'next/headers';
import { IncomesClient } from './IncomesClient';
import { getExchangeRates, getIncomes, getUsers } from '../../lib/api';

interface IncomesPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_CACHE = { next: { revalidate: 60 } } as const;
const SESSION_COOKIE = 'fairsplit_session';

function parseSessionCookie(rawValue: string | undefined): { userId: string | null } {
  if (!rawValue) {
    return { userId: null };
  }

  try {
    const decoded = decodeURIComponent(rawValue);
    const parsed = JSON.parse(decoded) as { userId?: unknown };
    return {
      userId: typeof parsed.userId === 'string' && parsed.userId.trim().length > 0 ? parsed.userId : null,
    };
  } catch {
    return { userId: null };
  }
}

export default async function IncomesPage({ searchParams }: IncomesPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? new Date().toISOString().slice(0, 7);
  const sessionCookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = parseSessionCookie(sessionCookie);
  const serverReadInit = session.userId
    ? ({ ...SERVER_READ_CACHE, headers: { 'x-fairsplit-user-id': session.userId } } as const)
    : SERVER_READ_CACHE;

  const [users, incomes, exchangeRates] = await Promise.all([
    getUsers(serverReadInit),
    getIncomes(month, serverReadInit),
    getExchangeRates(month, serverReadInit),
  ]);

  return <IncomesClient month={month} initialUsers={users} initialIncomes={incomes} initialExchangeRates={exchangeRates} />;
}
