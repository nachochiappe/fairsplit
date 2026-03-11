'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMonthNavigationPending } from './MonthNavigationPending';
import { addMonths } from '../lib/month';

interface MonthSelectorProps {
  month: string;
}

export function MonthSelector({ month }: MonthSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const { setIsPending: setNavigationPending } = useMonthNavigationPending();

  useEffect(() => {
    setPendingMonth(null);
    setNavigationPending(false);
  }, [month, setNavigationPending]);

  const onMonthChange = (nextMonth: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', nextMonth);
    setPendingMonth(nextMonth);
    setNavigationPending(true);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const displayedMonth = pendingMonth ?? month;

  return (
    <label
      aria-busy={isPending}
      className="flex w-full flex-col items-start gap-1.5 text-sm font-medium text-slate-700 sm:w-auto sm:flex-row sm:items-center sm:gap-3"
    >
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Month</span>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <button
          aria-label="Go to previous month"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-300/90 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          disabled={isPending}
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
        >
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12.5 4.5L7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          aria-label="Select month"
          autoComplete="off"
          className="min-h-11 w-full rounded-xl border border-slate-300/90 bg-white px-4 py-2.5 text-base font-medium leading-tight text-slate-700 shadow-sm [color-scheme:light] [&::-webkit-date-and-time-value]:text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto"
          disabled={isPending}
          lang="en"
          name="month"
          type="month"
          value={displayedMonth}
          onChange={(event) => onMonthChange(event.target.value)}
        />
        <button
          aria-label="Go to next month"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-300/90 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          disabled={isPending}
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
        >
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M7.5 4.5L13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {isPending ? (
        <span aria-live="polite" className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700"
          />
          Loading {displayedMonth}...
        </span>
      ) : null}
    </label>
  );
}
