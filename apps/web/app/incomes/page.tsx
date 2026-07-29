import { cookies } from 'next/headers';
import { IncomesClient } from './IncomesClient';
import { getExchangeRates, getIncomes, getUsers } from '../../lib/api';
import { buildServerApiInit, getServerRequestId, withServerApiLogging, withSessionRecovery } from '../../lib/server-api';
import { SESSION_COOKIE } from '../../lib/session';
import { verifySessionCookieToken } from '../../lib/session-server';
import { resolveLocaleForUser } from '../../lib/i18n';

interface IncomesPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_CACHE = { next: { revalidate: 60 } } as const;

export default async function IncomesPage({ searchParams }: IncomesPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? new Date().toISOString().slice(0, 7);
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionCookieToken(sessionToken);
  const requestId = await getServerRequestId();
  const serverReadInit = buildServerApiInit(
    requestId,
    SERVER_READ_CACHE,
    sessionToken ? { 'x-fairsplit-session': sessionToken } : undefined,
  );

  const [users, incomes, exchangeRates] = await withSessionRecovery(() =>
    withServerApiLogging(requestId, { month, route: '/incomes' }, async () =>
      Promise.all([
        getUsers(serverReadInit),
        getIncomes(month, serverReadInit),
        getExchangeRates(month, serverReadInit),
      ]),
    ),
  );

  return (
    <IncomesClient
      month={month}
      initialUsers={users}
      initialIncomes={incomes}
      initialExchangeRates={exchangeRates}
      locale={resolveLocaleForUser(users, session?.userId ?? null)}
    />
  );
}
