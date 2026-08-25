import { cookies } from 'next/headers';
import { cacheLife } from 'next/cache';
import { Suspense } from 'react';
import { ExpensesClient } from './ExpensesClient';
import { AppRouteLoading } from '../../components/AppRouteLoading';
import {
  Expense,
  getCategories,
  getExchangeRates,
  getExpenses,
  getSettlement,
  getUsers,
} from '../../lib/api';
import {
  buildServerApiInit,
  getServerRequestId,
  withServerApiLogging,
  withSessionRecovery,
} from '../../lib/server-api';
import { DEFAULT_MAX_ROWS_PER_SECTION, getSectionFetchBatchSize } from './pagination';
import { SESSION_COOKIE } from '../../lib/session';
import { verifySessionCookieToken } from '../../lib/session-server';
import { resolveLocaleForUser, t } from '../../lib/i18n';

interface ExpensesPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_INIT = { cache: 'no-store' } as const;
const INITIAL_EXPENSES_PAGE_SIZE = getSectionFetchBatchSize(DEFAULT_MAX_ROWS_PER_SECTION);
const NO_INCOME_SETTLEMENT_ERROR = 'Cannot calculate settlement when total income is non-positive';

export const instant = true;

function mergeUniqueExpenses(expenses: Expense[]): Expense[] {
  const dedupedById = new Map<string, Expense>();
  for (const expense of expenses) {
    dedupedById.set(expense.id, expense);
  }
  return Array.from(dedupedById.values());
}

export default function ExpensesPage(props: ExpensesPageProps) {
  return (
    <Suspense fallback={<AppRouteLoading label="Loading expenses..." />}>
      <ExpensesPageContent {...props} />
    </Suspense>
  );
}

async function ExpensesPageContent({ searchParams }: ExpensesPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? new Date().toISOString().slice(0, 7);
  const {
    categories,
    currentUserId,
    exchangeRates,
    fixedData,
    installmentData,
    locale,
    oneTimeData,
    settlement,
    totalsData,
    users,
  } = await getExpensesPageData(month);

  const noIncomeWarning = settlement === null ? t(locale).expenses.noIncomeWarning : null;
  const totalExpensesArs =
    settlement?.totalExpenses ?? totalsData.totals?.filteredSubtotalArs ?? '0.00';

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
      currentUserId={currentUserId}
      month={month}
      initialUsers={users}
      initialExpenses={mergeUniqueExpenses([
        ...fixedData.expenses,
        ...oneTimeData.expenses,
        ...installmentData.expenses,
      ])}
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
      locale={locale}
    />
  );
}

async function getExpensesPageData(month: string) {
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
  const [
    users,
    fixedData,
    categories,
    exchangeRates,
    oneTimeData,
    installmentData,
    totalsData,
    settlement,
  ] = await withSessionRecovery(() =>
    withServerApiLogging(requestId, { month, route: '/expenses' }, () =>
      Promise.all([
        getUsers(serverReadInit),
        getExpenses(
          month,
          {
            type: 'fixed',
            sortBy: 'date',
            sortDir: 'desc',
            limit: INITIAL_EXPENSES_PAGE_SIZE,
            includeCount: true,
          },
          serverReadInit,
        ),
        getCategories(serverReadInit),
        getExchangeRates(month, serverReadInit),
        getExpenses(
          month,
          {
            type: 'oneTime',
            sortBy: 'date',
            sortDir: 'desc',
            limit: INITIAL_EXPENSES_PAGE_SIZE,
            includeCount: false,
          },
          serverReadInit,
        ),
        getExpenses(
          month,
          {
            type: 'installment',
            sortBy: 'date',
            sortDir: 'desc',
            limit: INITIAL_EXPENSES_PAGE_SIZE,
            includeCount: false,
          },
          serverReadInit,
        ),
        getExpenses(
          month,
          {
            sortBy: 'date',
            sortDir: 'desc',
            limit: 1,
            includeCount: false,
            includeTotals: true,
          },
          serverReadInit,
        ),
        getSettlement(month, serverReadInit).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Failed to load settlement';
          if (message.includes(NO_INCOME_SETTLEMENT_ERROR)) {
            return null;
          }

          throw error;
        }),
      ]),
    ),
  );
  const sessionUserId = session?.userId ?? null;
  const currentUserId =
    sessionUserId && users.some((user) => user.id === sessionUserId) ? sessionUserId : null;
  const locale = resolveLocaleForUser(users, sessionUserId);

  return {
    categories,
    currentUserId,
    exchangeRates,
    fixedData,
    installmentData,
    locale,
    oneTimeData,
    settlement,
    totalsData,
    users,
  };
}
