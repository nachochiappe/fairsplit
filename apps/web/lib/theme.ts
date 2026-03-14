const superCategoryAccentTokens = {
  Housing: 'var(--accent-housing)',
  Lifestyle: 'var(--accent-lifestyle)',
  Essentials: 'var(--accent-essentials)',
  Mobility: 'var(--accent-mobility)',
  Finance: 'var(--accent-finance)',
  Other: 'var(--accent-other)',
} as const;

export function getSuperCategoryAccentColor(
  superCategoryName: string | null | undefined,
  fallbackColor?: string | null,
): string {
  if (fallbackColor && fallbackColor.trim().length > 0) {
    return fallbackColor;
  }

  if (!superCategoryName) {
    return superCategoryAccentTokens.Other;
  }

  return superCategoryAccentTokens[superCategoryName as keyof typeof superCategoryAccentTokens] ?? superCategoryAccentTokens.Other;
}
