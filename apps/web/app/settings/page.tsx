import { cookies } from 'next/headers';
import { cacheLife } from 'next/cache';
import { Suspense } from 'react';
import {
  getCategories,
  getHouseholdSplitPolicy,
  getPasskeys,
  getPersonalBudgetForecast,
  getSuperCategories,
  getUser,
  getUsers,
} from '../../lib/api';
import { getCurrentMonth } from '../../lib/month';
import {
  buildServerApiInit,
  getServerRequestId,
  withServerApiLogging,
  withSessionRecovery,
} from '../../lib/server-api';
import { AppRouteLoading } from '../../components/AppRouteLoading';
import { SettingsClient } from './SettingsClient';
import { SESSION_COOKIE } from '../../lib/session';
import { verifySessionCookieToken } from '../../lib/session-server';
import { resolveLocale } from '../../lib/i18n';

const SERVER_READ_INIT = { cache: 'no-store' } as const;

export const instant = true;

export default function SettingsPage() {
  return (
    <Suspense fallback={<AppRouteLoading label="Loading settings..." />}>
      <SettingsPageContent />
    </Suspense>
  );
}

async function SettingsPageContent() {
  const { categories, currentUser, householdUsers, month, passkeys, personalBudget, splitPolicy, superCategories } =
    await getSettingsPageData();

  return (
    <SettingsClient
      currentUserEmail={currentUser?.email ?? null}
      currentUserId={currentUser?.id ?? null}
      currentUserLocale={resolveLocale(currentUser)}
      currentUserName={currentUser?.name ?? null}
      initialCategories={categories}
      initialPasskeys={passkeys.passkeys}
      initialPersonalBudget={personalBudget}
      initialSplitPolicy={splitPolicy}
      initialSuperCategories={superCategories}
      isOnlyHouseholdMember={householdUsers.length <= 1}
      month={month}
      passkeysConfigured={passkeys.configured}
    />
  );
}

async function getSettingsPageData() {
  'use cache: private';
  cacheLife({ stale: 30, revalidate: 30, expire: 60 });

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const month = getCurrentMonth();
  const session = await verifySessionCookieToken(sessionToken);
  const requestId = await getServerRequestId();
  const serverReadInit = buildServerApiInit(
    requestId,
    SERVER_READ_INIT,
    sessionToken ? { 'x-fairsplit-session': sessionToken } : undefined,
  );

  const sessionUserId = session?.userId ?? null;

  const [categories, superCategories, currentUser, passkeys, householdUsers, splitPolicy, personalBudget] =
    await withSessionRecovery(() =>
      withServerApiLogging(requestId, { month, route: '/settings' }, async () =>
        Promise.all([
          getCategories(serverReadInit),
          getSuperCategories(serverReadInit),
          sessionUserId ? getUser(sessionUserId, serverReadInit) : Promise.resolve(null),
          getPasskeys(serverReadInit),
          getUsers(serverReadInit),
          getHouseholdSplitPolicy(serverReadInit),
          getPersonalBudgetForecast(month, serverReadInit),
        ]),
      ),
    );

  return {
    categories,
    currentUser,
    householdUsers,
    month,
    passkeys,
    personalBudget,
    splitPolicy,
    superCategories,
  };
}
