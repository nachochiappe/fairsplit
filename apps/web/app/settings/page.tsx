import { cookies } from 'next/headers';
import { getCategories, getSuperCategories, getUser } from '../../lib/api';
import { getCurrentMonth } from '../../lib/month';
import { buildServerApiInit, getServerRequestId, withServerApiLogging } from '../../lib/server-api';
import { SettingsClient } from './SettingsClient';
import { SESSION_COOKIE } from '../../lib/session';
import { verifySessionCookieToken } from '../../lib/session-server';

const SERVER_READ_CACHE = { next: { revalidate: 15 } } as const;

export default async function SettingsPage() {
  const month = getCurrentMonth();
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionCookieToken(sessionToken);
  const requestId = await getServerRequestId();
  const serverReadInit = buildServerApiInit(
    requestId,
    SERVER_READ_CACHE,
    sessionToken ? { 'x-fairsplit-session': sessionToken } : undefined,
  );

  const sessionUserId = session?.userId ?? null;

  const [categories, superCategories, currentUser] = await withServerApiLogging(
    requestId,
    { month, route: '/settings' },
    async () =>
      Promise.all([
        getCategories(serverReadInit),
        getSuperCategories(serverReadInit),
        sessionUserId ? getUser(sessionUserId, serverReadInit) : Promise.resolve(null),
      ]),
  );

  return (
    <SettingsClient
      currentUserEmail={currentUser?.email ?? null}
      currentUserId={currentUser?.id ?? null}
      currentUserName={currentUser?.name ?? null}
      initialCategories={categories}
      initialSuperCategories={superCategories}
      month={month}
    />
  );
}
