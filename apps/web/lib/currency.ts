import type { AppLocale } from './api';
import { DEFAULT_LOCALE, localeTags } from './i18n';

/**
 * Amounts are already normalized to ARS by the settlement layer, so the symbol
 * is fixed and only the grouping/decimal separators follow the user's locale.
 */
export const formatMoney = (value: string | number, locale: AppLocale = DEFAULT_LOCALE): string => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return `$${new Intl.NumberFormat(localeTags[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric)}`;
};

export const formatPercent = (
  value: string | number,
  locale: AppLocale = DEFAULT_LOCALE,
): string => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return `${new Intl.NumberFormat(localeTags[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric * 100)}%`;
};
