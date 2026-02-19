import { ReactNode } from 'react';
import { Nav } from './Nav';

interface AppShellProps {
  month: string;
  title: string;
  subtitle: string;
  rightSlot?: ReactNode;
  containerClassName?: string;
  children: ReactNode;
}

export function AppShell({ month, title, subtitle, rightSlot, containerClassName, children }: AppShellProps) {
  return (
    <main
      id="main-content"
      className={`mx-auto min-h-screen w-full px-4 py-8 md:px-6 md:py-10 ${containerClassName ?? 'max-w-[1400px]'}`}
    >
      <header className="mb-7 flex flex-col gap-5 rounded-3xl border border-slate-200/80 bg-white/75 p-6 shadow-sm backdrop-blur-md md:flex-row md:items-center md:justify-between md:p-9">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">FairSplit</p>
          <h1 className="mt-2 text-pretty text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-base text-slate-600">{subtitle}</p>
        </div>
        {rightSlot}
      </header>
      <Nav month={month} />
      <section className="rounded-3xl border border-slate-200/80 bg-white/75 p-4 shadow-sm backdrop-blur md:p-6">
        {children}
      </section>
    </main>
  );
}
