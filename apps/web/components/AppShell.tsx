'use client';

import { ReactNode } from 'react';
import {
  MonthNavigationPendingProvider,
  useMonthNavigationPending,
} from './MonthNavigationPending';
import { Nav } from './Nav';
import { TitleMark } from './TitleMark';
import { LocaleSync } from './LocaleSync';
import { type AppLocale } from '../lib/api';

interface AppShellProps {
  month: string;
  title: string;
  subtitle: string;
  locale: AppLocale;
  rightSlot?: ReactNode;
  compact?: boolean;
  unframed?: boolean;
  children: ReactNode;
}

export function AppShell({
  month,
  title,
  subtitle,
  locale,
  rightSlot,
  compact = false,
  unframed = false,
  children,
}: AppShellProps) {
  return (
    <MonthNavigationPendingProvider>
      <AppShellContent
        month={month}
        title={title}
        subtitle={subtitle}
        locale={locale}
        rightSlot={rightSlot}
        compact={compact}
        unframed={unframed}
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
  locale,
  rightSlot,
  compact = false,
  unframed = false,
  children,
}: AppShellProps) {
  const { isPending } = useMonthNavigationPending();

  return (
    <main
      id="main-content"
      className={`mx-auto min-h-screen w-full max-w-[1400px] px-4 pb-28 md:px-6 md:pb-10 ${compact ? 'pt-5 md:pt-7' : 'pt-8 md:pt-10'}`}
    >
      <header
        className={`${compact ? 'mb-5 gap-4 rounded-3xl px-4 py-4 md:px-6' : 'mb-7 gap-5 rounded-3xl p-6 md:p-9'} flex flex-col border border-stroke/80 bg-surface shadow-sm md:flex-row md:items-center md:justify-between`}
      >
        <div className={`flex items-center ${compact ? 'gap-4' : 'gap-6'}`}>
          <TitleMark
            className={`${compact ? 'h-10 w-10 rounded-xl' : 'h-12 w-12 rounded-2xl md:h-14 md:w-14'} shrink-0`}
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">
              Fairsplit
            </p>
            <div className={compact ? 'mt-1 md:flex md:items-baseline md:gap-3' : ''}>
              <h1
                className={`${compact ? 'text-2xl md:text-3xl' : 'mt-2 text-3xl md:text-5xl'} text-pretty font-bold tracking-tight text-ink-strong`}
              >
                {title}
              </h1>
              <p
                className={`${compact ? 'mt-1 text-sm md:mt-0' : 'mt-2 text-base'} max-w-2xl text-ink-muted`}
              >
                {subtitle}
              </p>
            </div>
          </div>
        </div>
        {rightSlot}
      </header>
      <LocaleSync locale={locale} />
      <Nav month={month} locale={locale} />
      <section
        className={
          unframed
            ? 'relative'
            : 'relative rounded-3xl border border-stroke/80 bg-surface p-4 shadow-sm md:p-6'
        }
      >
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
