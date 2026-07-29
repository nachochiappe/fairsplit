import { cookies } from 'next/headers';
import { ExpensesClient } from './ExpensesClient';
import { Expense, getCategories, getExchangeRates, getExpenses, getSettlement, getUsers } from '../../lib/api';
import { buildServerApiInit, getServerRequestId, withServerApiLogging, withSessionRecovery } from '../../lib/server-api';
import { DEFAULT_MAX_ROWS_PER_SECTION, getSectionFetchBatchSize } from './pagination';
import { SESSION_COOKIE } from '../../lib/session';
import { verifySessionCookieToken } from '../../lib/session-server';
import { resolveLocaleForUser, t } from '../../lib/i18n';

interface ExpensesPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_CACHE = { next: { revalidate: 60 } } as const;
const INITIAL_EXPENSES_PAGE_SIZE = getSectionFetchBatchSize(DEFAULT_MAX_ROWS_PER_SECTION);
const NO_INCOME_SETTLEMENT_ERROR = 'Cannot calculate settlement when total income is non-positive';

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
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionCookieToken(sessionToken);
  const requestId = await getServerRequestId();
  const serverReadInit = buildServerApiInit(
    requestId,
    SERVER_READ_CACHE,
    sessionToken ? { 'x-fairsplit-session': sessionToken } : undefined,
  );
  // Two tiers, not one: the `hydrate: true` read is what generates this month's
  // recurring and installment rows, so anything that counts or sums the month has
  // to wait for it. Everything that doesn't depend on generation rides along in
  // tier one instead of blocking behind its own round trip.
  const [users, fixedData, categories, exchangeRates] = await withSessionRecovery(() =>
    withServerApiLogging(requestId, { month, route: '/expenses', step: 'bootstrap' }, async () =>
      Promise.all([
        getUsers(serverReadInit),
        getExpenses(
          month,
          {
            type: 'fixed',
            sortBy: 'date',
            sortDir: 'desc',
            limit: INITIAL_EXPENSES_PAGE_SIZE,
            hydrate: true,
            includeCount: true,
          },
          serverReadInit,
        ),
        getCategories(serverReadInit),
        getExchangeRates(month, serverReadInit),
      ]),
    ),
  );
  const sessionUserId = session?.userId ?? null;
  const currentUserId = sessionUserId && users.some((user) => user.id === sessionUserId) ? sessionUserId : null;
  const locale = resolveLocaleForUser(users, sessionUserId);
  const [oneTimeData, installmentData, totalsData, settlement] = await withSessionRecovery(() =>
    withServerApiLogging(requestId, { month, route: '/expenses', step: 'month-totals' }, async () =>
      Promise.all([
        getExpenses(
          month,
          {
            type: 'oneTime',
            sortBy: 'date',
            sortDir: 'desc',
            limit: INITIAL_EXPENSES_PAGE_SIZE,
            hydrate: false,
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
            hydrate: false,
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
            hydrate: false,
            includeCount: false,
            includeTotals: true,
          },
          serverReadInit,
        ),
        // Settlement throws when the household has expenses but no income. That is a
        // legitimate state on the expenses screen, so it resolves to null and the
        // month total falls back to the unfiltered subtotal we already asked for.
        getSettlement(month, serverReadInit, { hydrate: false }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Failed to load settlement';
          if (message.includes(NO_INCOME_SETTLEMENT_ERROR)) {
            return null;
          }

          throw error;
        }),
      ]),
    ),
  );

  const noIncomeWarning = settlement === null ? t(locale).expenses.noIncomeWarning : null;
  const totalExpensesArs = settlement?.totalExpenses ?? totalsData.totals?.filteredSubtotalArs ?? '0.00';

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
      locale={locale}
    />
  );
}
