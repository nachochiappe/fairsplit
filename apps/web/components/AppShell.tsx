'use client';

import { ReactNode } from 'react';
import {
  MonthNavigationPendingProvider,
  useMonthNavigationPending,
} from './MonthNavigationPending';
import { Nav } from './Nav';
import { TitleMark } from './TitleMark';

interface AppShellProps {
  month: string;
  title: string;
  subtitle: string;
  rightSlot?: ReactNode;
  containerClassName?: string;
  children: ReactNode;
}

export function AppShell({
  month,
  title,
  subtitle,
  rightSlot,
  containerClassName,
  children,
}: AppShellProps) {
  return (
    <MonthNavigationPendingProvider>
      <AppShellContent
        month={month}
        title={title}
        subtitle={subtitle}
        rightSlot={rightSlot}
        containerClassName={containerClassName}
      >
        {children}
      </AppShellContent>
    </MonthNavigationPendingProvider>
  );
}

function AppShellContent({
  month,
  title,
  subtitle,
  rightSlot,
  containerClassName,
  children,
}: AppShellProps) {
  const { isPending } = useMonthNavigationPending();

  return (
    <main
      id="main-content"
      className={`mx-auto min-h-screen w-full px-4 pb-28 pt-8 md:px-6 md:pb-10 md:pt-10 ${containerClassName ?? 'max-w-[1400px]'}`}
    >
      <header className="mb-7 flex flex-col gap-5 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between md:p-9">
        <div className="flex items-center gap-6">
          <TitleMark className="h-12 w-12 shrink-0 rounded-2xl md:h-14 md:w-14" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">
              Fairsplit
            </p>
            <h1 className="mt-2 text-pretty text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">
              {title}
            </h1>
            <p className="mt-2 max-w-2xl text-base text-slate-600">{subtitle}</p>
          </div>
        </div>
        {rightSlot}
      </header>
      <Nav month={month} />
      <section className="relative rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm md:p-6">
        <div
          aria-busy={isPending}
          className={`transition duration-200 ${isPending ? 'pointer-events-none select-none blur-[3px] opacity-70' : 'opacity-100'}`}
        >
          {children}
        </div>
      </section>
    </main>
  );
}
