'use client';

import { usePathname, useRouter } from 'next/navigation';

interface MonthSelectorProps {
  month: string;
}

export function MonthSelector({ month }: MonthSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();

  const onMonthChange = (nextMonth: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('month', nextMonth);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Month</span>
      <input
        aria-label="Select month"
        autoComplete="off"
        className="rounded-xl border border-slate-300/90 bg-white px-4 py-2.5 text-base font-medium text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        name="month"
        type="month"
        value={month}
        onChange={(event) => onMonthChange(event.target.value)}
      />
    </label>
  );
}
