import { cookies } from 'next/headers';
import { getCategories, getSuperCategories, getUsers } from '../../lib/api';
import { getCurrentMonth } from '../../lib/month';
import { SettingsClient } from './SettingsClient';
import { parseSessionToken, SESSION_COOKIE } from '../../lib/session';

const SERVER_READ_CACHE = { next: { revalidate: 15 } } as const;

export default async function SettingsPage() {
  const month = getCurrentMonth();
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = parseSessionToken(sessionToken);
  const serverReadInit = sessionToken
    ? ({ ...SERVER_READ_CACHE, headers: { 'x-fairsplit-session': sessionToken } } as const)
    : SERVER_READ_CACHE;

  const [categories, superCategories, users] = await Promise.all([
    getCategories(serverReadInit),
    getSuperCategories(serverReadInit),
    getUsers(serverReadInit),
  ]);

  const sessionUserId = session?.userId ?? null;
  const currentUser = sessionUserId
    ? users.find((user) => user.id === sessionUserId) ?? null
    : null;

  return (
    <SettingsClient
      currentUserEmail={session?.email ?? null}
      currentUserId={currentUser?.id ?? null}
      currentUserName={currentUser?.name ?? null}
      initialCategories={categories}
      initialSuperCategories={superCategories}
      month={month}
    />
  );
}
