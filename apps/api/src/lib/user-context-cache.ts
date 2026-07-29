/**
 * Short-lived cache for the per-request user lookup in `requireUserContext`.
 *
 * Every authenticated endpoint re-reads the same four columns for the same user,
 * so a single page load repeats one primary-key lookup seven or eight times. That
 * is cheap against a local Postgres but not against a pooled remote one, where
 * each repeat is a network round trip.
 *
 * The cached fields include the revocation state, so this trades a bounded amount
 * of revocation staleness for those round trips. Two things keep that bound tight:
 * the TTL is deliberately small, and every route that revokes a session or moves a
 * user between households calls `invalidateUserContext`, which makes revocation
 * exact within a process. Only additional API instances can observe a stale entry,
 * and only until the TTL lapses.
 */
export interface CachedUserContext {
  id: string;
  householdId: string | null;
  onboardingHouseholdDecisionAt: Date | null;
  /** Account-wide revocation: every session issued at or before this is dead. */
  sessionRevokedAt: Date | null;
  /** `sid`s signed out individually and not yet past their own expiry. */
  revokedSessionIds: string[];
}

interface CacheEntry {
  expiresAt: number;
  value: CachedUserContext | null;
}

const DEFAULT_TTL_MS = 3_000;

function resolveTtlMs(): number {
  const raw = process.env.FAIRSPLIT_USER_CONTEXT_CACHE_TTL_MS;
  if (raw === undefined) {
    return DEFAULT_TTL_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_TTL_MS;
  }
  return parsed;
}

const cache = new Map<string, CacheEntry>();

/**
 * Returns the cached context, `null` when the user is known not to exist, or
 * `undefined` on a miss so callers can distinguish "absent" from "known absent".
 */
export function getCachedUserContext(userId: string): CachedUserContext | null | undefined {
  const entry = cache.get(userId);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(userId);
    return undefined;
  }
  return entry.value;
}

export function setCachedUserContext(userId: string, value: CachedUserContext | null): void {
  const ttlMs = resolveTtlMs();
  if (ttlMs === 0) {
    return;
  }
  cache.set(userId, { expiresAt: Date.now() + ttlMs, value });
}

export function invalidateUserContext(userId: string): void {
  cache.delete(userId);
}

export function clearUserContextCache(): void {
  cache.clear();
}
