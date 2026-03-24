export const cardClass = 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm';

export const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

export const compactFieldClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

export const tableControlLabelClass =
  'mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft';

export const tableControlFieldClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink-strong shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

export const tableControlSearchFieldClass = `${tableControlFieldClass} pr-10 [&::-webkit-search-cancel-button]:appearance-none`;

export const primaryButtonClass =
  'rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink-base hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

export const moneyInputClass = `${fieldClass} pl-8 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

export const pillToggleTrackClass =
  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-slate-300 bg-slate-200 transition-colors duration-200 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600 peer-focus-visible:ring-offset-2 peer-checked:border-brand-600 peer-checked:bg-brand-600';

export const pillToggleThumbClass =
  'absolute left-[2px] top-[2px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 peer-checked:translate-x-5';
