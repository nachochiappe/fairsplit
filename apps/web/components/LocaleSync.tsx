'use client';

import { useEffect } from 'react';
import { type AppLocale } from '../lib/api';
import { localeTags } from '../lib/i18n';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS } from '../lib/locale-cookie';

/**
 * Keeps the document language and the locale cookie in step with the locale the
 * server resolved for this render. Keeping this client-side leaves the root
 * layout static so every route can reuse it during instant navigations.
 */
export function LocaleSync({ locale }: { locale: AppLocale }) {
  useEffect(() => {
    document.documentElement.lang = localeTags[locale];
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  }, [locale]);

  return null;
}
