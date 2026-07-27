import type { AppLocale } from './api';

/**
 * Display-preference mirror of `User.locale`. Not a credential, so it is
 * readable by the client: it lets the root layout emit the right `<html lang>`
 * without an extra API round trip, and gives pages a locale to fall back on
 * when the backend is unreachable.
 */
export const LOCALE_COOKIE = 'fairsplit-locale';

export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function parseLocaleCookie(value: string | undefined): AppLocale | null {
  return value === 'es' || value === 'en' ? value : null;
}
