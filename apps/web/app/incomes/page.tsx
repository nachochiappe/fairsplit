import { cookies } from 'next/headers';
import { cacheLife } from 'next/cache';
import { Suspense } from 'react';
import { IncomesClient } from './IncomesClient';
import { AppRouteLoading } from '../../components/AppRouteLoading';
import { getExchangeRates, getIncomes, getUsers } from '../../lib/api';
import {
  buildServerApiInit,
  getServerRequestId,
  withServerApiLogging,
  withSessionRecovery,
} from '../../lib/server-api';
import { SESSION_COOKIE } from '../../lib/session';
import { verifySessionCookieToken } from '../../lib/session-server';
import { resolveLocaleForUser } from '../../lib/i18n';

interface IncomesPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_INIT = { cache: 'no-store' } as const;

export const instant = true;

export default function IncomesPage(props: IncomesPageProps) {
  return (
    <Suspense fallback={<AppRouteLoading label="Loading incomes..." />}>
      <IncomesPageContent {...props} />
    </Suspense>
  );
}

async function IncomesPageContent({ searchParams }: IncomesPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? new Date().toISOString().slice(0, 7);
  const { exchangeRates, incomes, locale, users } = await getIncomesPageData(month);

  return (
    <IncomesClient
      month={month}
      initialUsers={users}
      initialIncomes={incomes}
      initialExchangeRates={exchangeRates}
      locale={locale}
    />
  );
}

async function getIncomesPageData(month: string) {
  'use cache: private';
  cacheLife({ stale: 300, revalidate: 300, expire: 600 });

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionCookieToken(sessionToken);
  const requestId = await getServerRequestId();
  const serverReadInit = buildServerApiInit(
    requestId,
    SERVER_READ_INIT,
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

  return {
    exchangeRates,
    incomes,
    locale: resolveLocaleForUser(users, session?.userId ?? null),
    users,
  };
}
