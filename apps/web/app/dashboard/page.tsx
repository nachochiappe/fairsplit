import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DashboardClient } from './DashboardClient';
import { buildServerApiInit, getServerRequestId, withServerApiLogging } from '../../lib/server-api';
import { SESSION_COOKIE, SESSION_EXPIRED_PATH } from '../../lib/session';
import { verifySessionCookieToken } from '../../lib/session-server';
import { resolveLocaleForUser, t } from '../../lib/i18n';
import { LOCALE_COOKIE, parseLocaleCookie } from '../../lib/locale-cookie';
import {
  getExpenseTotals,
  getIncomes,
  getSettlement,
  getUsers,
  isSessionExpiredError,
  type ExpenseCategoryTotal,
  type ExpenseTotalsResponse,
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
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySessionCookieToken(sessionToken);
  // The user's locale lives behind the API, so a backend outage has to fall
  // back to the cookie mirror written on the last successful render.
  const fallbackLocale = parseLocaleCookie(cookieStore.get(LOCALE_COOKIE)?.value) ?? 'en';
  const requestId = await getServerRequestId();
  const serverReadInit = buildServerApiInit(
    requestId,
    SERVER_READ_CACHE,
    sessionToken ? { 'x-fairsplit-session': sessionToken } : undefined,
  );
  let users: User[] = [];
  let incomes: Income[] = [];
  let settlementResult: SettlementResponse | null = null;
  let expenseTotals: ExpenseTotalsResponse | null = null;

  try {
    // Two tiers, not one: the `hydrate: true` read generates this month's recurring
    // and installment rows, and settlement has to observe them or it reports a
    // short month total on the first visit to a month.
    [users, incomes, expenseTotals] = await withServerApiLogging(
      requestId,
      { month, route: '/dashboard', step: 'bootstrap' },
      async () =>
        Promise.all([
          getUsers(serverReadInit),
          getIncomes(month, serverReadInit),
          getExpenseTotals(month, serverReadInit, { hydrate: true }),
        ]),
    );
    settlementResult = await withServerApiLogging(
      requestId,
      { month, route: '/dashboard', step: 'settlement' },
      () =>
        getSettlement(month, serverReadInit, { hydrate: false }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Failed to load settlement';
          if (message.includes('Cannot calculate settlement when total income is non-positive')) {
            return null;
          }

          throw error;
        }),
    );
  } catch (error) {
    // A revoked session is not an outage: the middleware cleared this request on
    // signature alone, so recovery is to drop the cookie and sign in again.
    if (isSessionExpiredError(error)) {
      redirect(SESSION_EXPIRED_PATH);
    }
    const message = error instanceof Error ? error.message : 'Failed to connect to API';
    const settlement = buildNoIncomeSettlement(month, [], [], {});
    return (
      <DashboardClient
        month={month}
        users={[]}
        settlement={settlement}
        incomes={[]}
        warning={t(fallbackLocale).dashboard.backendUnavailable(message)}
        locale={fallbackLocale}
      />
    );
  }

  const locale = resolveLocaleForUser(users, session?.userId ?? null);
  let settlement: SettlementResponse;
  let warning: string | null = null;

  if (settlementResult) {
    settlement = settlementResult;
  } else {
    settlement = buildNoIncomeSettlement(month, users, incomes, expenseTotals?.byUser ?? {});
    warning = t(locale).expenses.noIncomeWarning;
  }

  return (
    <DashboardClient
      month={month}
      users={users}
      settlement={settlement}
      incomes={incomes}
      warning={warning}
      expenseCategorySlices={buildExpenseCategorySlices(expenseTotals?.byCategory ?? [])}
      locale={locale}
    />
  );
}

function buildNoIncomeSettlement(
  month: string,
  users: User[],
  incomes: Income[],
  paidByUserTotals: Record<string, string>,
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

  for (const [userId, total] of Object.entries(paidByUserTotals)) {
    paidByUser[userId] = (paidByUser[userId] ?? 0) + Number(total);
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

function buildExpenseCategorySlices(byCategory: ExpenseCategoryTotal[]): ExpenseCategorySlice[] {
  // The API already groups and orders these; the pie chart only shows positive
  // slices, and expenses are allowed to be negative.
  return byCategory
    .map((entry) => ({
      categoryName: entry.categoryName,
      totalArs: Number(entry.totalArs),
      superCategoryName: entry.superCategoryName,
      superCategoryColor: entry.superCategoryColor,
    }))
    .filter((entry) => entry.totalArs > 0)
    .sort((a, b) => b.totalArs - a.totalArs);
}
