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
  mobileTitle?: string;
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
  mobileTitle,
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
        mobileTitle={mobileTitle}
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
  mobileTitle,
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
      className={`mx-auto min-h-screen w-full max-w-[1400px] px-4 pb-[var(--mobile-nav-clearance)] md:px-6 md:pb-10 ${compact ? 'pt-3 md:pt-7' : 'pt-8 md:pt-10'}`}
    >
      <header
        className={`${
          compact
            ? 'mb-3 gap-3 md:mb-5 md:gap-4 md:rounded-3xl md:border md:border-stroke/80 md:bg-surface md:px-6 md:py-4 md:shadow-sm'
            : 'mb-7 gap-5 rounded-3xl border border-stroke/80 bg-surface p-6 shadow-sm md:p-9'
        } flex flex-col md:flex-row md:items-center md:justify-between`}
      >
        <div className={`${compact ? 'flex w-full items-center justify-between md:w-auto' : ''}`}>
          <div className={`flex items-center ${compact ? 'gap-3 md:gap-4' : 'gap-6'}`}>
            <TitleMark
              className={`${compact ? 'h-9 w-9 rounded-xl md:h-10 md:w-10' : 'h-12 w-12 rounded-2xl md:h-14 md:w-14'} shrink-0`}
            />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">
                Fairsplit
              </p>
              <div className={compact ? 'md:mt-1 md:flex md:items-baseline md:gap-3' : ''}>
                <h1
                  className={`${compact ? 'text-xl md:text-3xl' : 'mt-2 text-3xl md:text-5xl'} text-pretty font-bold tracking-tight text-ink-strong`}
                >
                  <span className="md:hidden">{mobileTitle ?? title}</span>
                  <span className="hidden md:inline">{title}</span>
                </h1>
                <p
                  className={`${compact ? 'hidden text-sm md:mt-0 md:block' : 'mt-2 text-base'} max-w-2xl text-ink-muted`}
                >
                  {subtitle}
                </p>
              </div>
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
