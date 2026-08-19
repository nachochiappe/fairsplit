'use client';

import { CATEGORY_ICON_KEYS, type CategoryIconKey } from '@fairsplit/shared';
import { useId } from 'react';
import { CategoryIcon } from './CategoryIcon';

export function CategoryIconPicker({
  iconLabels,
  label,
  onChange,
  onUseSuggestion,
  suggestedIcon,
  suggestionLabel,
  useSuggestionLabel,
  value,
}: {
  iconLabels: Record<CategoryIconKey, string>;
  label: string;
  onChange: (icon: CategoryIconKey) => void;
  onUseSuggestion: () => void;
  suggestedIcon: CategoryIconKey;
  suggestionLabel: (name: string) => string;
  useSuggestionLabel: string;
  value: CategoryIconKey;
}) {
  const inputName = useId();

  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink-base">{label}</legend>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-ink-muted">
          <CategoryIcon className="h-4 w-4 shrink-0" icon={suggestedIcon} />
          <span className="truncate">{suggestionLabel(iconLabels[suggestedIcon])}</span>
        </span>
        <button
          className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          onClick={onUseSuggestion}
          type="button"
        >
          {useSuggestionLabel}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(44px,1fr))] gap-2">
        {CATEGORY_ICON_KEYS.map((icon) => (
          <label className="relative cursor-pointer" key={icon} title={iconLabels[icon]}>
            <input
              checked={value === icon}
              className="peer sr-only"
              name={inputName}
              onChange={() => onChange(icon)}
              type="radio"
              value={icon}
            />
            <span className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-300 bg-white text-ink-muted transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-brand-700 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600 peer-focus-visible:ring-offset-2">
              <CategoryIcon icon={icon} />
              <span className="sr-only">{iconLabels[icon]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
