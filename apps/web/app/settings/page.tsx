import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { getCategories, getPasskeys, getSuperCategories, getUser, getUsers } from '../../lib/api';
import { getCurrentMonth } from '../../lib/month';
import { buildServerApiInit, getServerRequestId, withServerApiLogging, withSessionRecovery } from '../../lib/server-api';
import { SettingsClient } from './SettingsClient';
import { SESSION_COOKIE } from '../../lib/session';
import { verifySessionCookieToken } from '../../lib/session-server';
import { resolveLocale } from '../../lib/i18n';

const SERVER_READ_CACHE = { next: { revalidate: 15 } } as const;

export default async function SettingsPage() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  await connection();
  const month = getCurrentMonth();
  const session = await verifySessionCookieToken(sessionToken);
  const requestId = await getServerRequestId();
  const serverReadInit = buildServerApiInit(
    requestId,
    SERVER_READ_CACHE,
    sessionToken ? { 'x-fairsplit-session': sessionToken } : undefined,
  );

  const sessionUserId = session?.userId ?? null;

  const [categories, superCategories, currentUser, passkeys, householdUsers] = await withSessionRecovery(() =>
    withServerApiLogging(requestId, { month, route: '/settings' }, async () =>
      Promise.all([
        getCategories(serverReadInit),
        getSuperCategories(serverReadInit),
        sessionUserId ? getUser(sessionUserId, serverReadInit) : Promise.resolve(null),
        getPasskeys(serverReadInit),
        getUsers(serverReadInit),
      ]),
    ),
  );

  return (
    <SettingsClient
      currentUserEmail={currentUser?.email ?? null}
      currentUserId={currentUser?.id ?? null}
      currentUserLocale={resolveLocale(currentUser)}
      currentUserName={currentUser?.name ?? null}
      initialCategories={categories}
      initialPasskeys={passkeys.passkeys}
      initialSuperCategories={superCategories}
      isOnlyHouseholdMember={householdUsers.length <= 1}
      month={month}
      passkeysConfigured={passkeys.configured}
    />
  );
}
