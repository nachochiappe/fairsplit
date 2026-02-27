import { cookies } from 'next/headers';
import { getCategories, getSuperCategories, getUsers } from '../../lib/api';
import { getCurrentMonth } from '../../lib/month';
import { SettingsClient } from './SettingsClient';

const SERVER_READ_CACHE = { next: { revalidate: 15 } } as const;
const SESSION_COOKIE = 'fairsplit_session';

function parseSessionCookie(rawValue: string | undefined): { userId: string | null; email: string | null } {
  if (!rawValue) {
    return { userId: null, email: null };
  }

  try {
    const decoded = decodeURIComponent(rawValue);
    const parsed = JSON.parse(decoded) as { userId?: unknown; email?: unknown };
    return {
      userId: typeof parsed.userId === 'string' && parsed.userId.trim().length > 0 ? parsed.userId : null,
      email: typeof parsed.email === 'string' && parsed.email.trim().length > 0 ? parsed.email : null,
    };
  } catch {
    return { userId: null, email: null };
  }
}

export default async function SettingsPage() {
  const month = getCurrentMonth();
  const sessionCookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = parseSessionCookie(sessionCookie);
  const serverReadInit = session.userId
    ? ({ ...SERVER_READ_CACHE, headers: { 'x-fairsplit-user-id': session.userId } } as const)
    : SERVER_READ_CACHE;

  const [categories, superCategories, users] = await Promise.all([
    getCategories(serverReadInit),
    getSuperCategories(serverReadInit),
    getUsers(serverReadInit),
  ]);

  const currentUser = session.userId
    ? users.find((user) => user.id === session.userId) ?? null
    : null;

  return (
    <SettingsClient
      currentUserEmail={session.email}
      currentUserId={currentUser?.id ?? null}
      currentUserName={currentUser?.name ?? null}
      initialCategories={categories}
      initialSuperCategories={superCategories}
      month={month}
    />
  );
}
