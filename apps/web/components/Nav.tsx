'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    monthScoped: true,
    icon: (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
      >
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6.5 9.5V20h11V9.5" />
      </svg>
    ),
  },
  {
    href: '/incomes',
    label: 'Incomes',
    monthScoped: true,
    icon: (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
      >
        <path d="M12 3v18" />
        <path d="M17 8.5c0-1.9-1.9-3.5-5-3.5S7 6.3 7 8.1c0 4.8 10 2.4 10 7.4 0 1.9-1.9 3.5-5 3.5S7 17.7 7 15.5" />
      </svg>
    ),
  },
  {
    href: '/expenses',
    label: 'Expenses',
    monthScoped: true,
    icon: (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
      >
        <path d="M6 4h10l2 3v13H6z" />
        <path d="M9 9h6" />
        <path d="M9 13h6" />
        <path d="M9 17h4" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    monthScoped: false,
    icon: (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
      >
        <path d="M12 8.75A3.25 3.25 0 1 0 12 15.25 3.25 3.25 0 0 0 12 8.75Z" />
        <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.6 1Z" />
      </svg>
    ),
  },
] as const;

export function Nav({ month }: { month: string }) {
  const pathname = usePathname();

  return (
    <>
      <nav
        aria-label="Primary"
        className="mb-8 hidden grid-cols-2 gap-2 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-sm md:grid md:grid-cols-4"
      >
        {links.map((link) => {
          const href = month && link.monthScoped ? `${link.href}?month=${month}` : link.href;
          const isCurrent = pathname === link.href;

          return (
            <Link
              className={`rounded-xl px-4 py-3 text-center text-base font-semibold ${
                isCurrent
                  ? 'bg-brand-600 text-white shadow-md shadow-brand-700/25'
                  : 'text-slate-500 hover:text-slate-800'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2`}
              key={link.href}
              href={href}
              prefetch={false}
              aria-current={isCurrent ? 'page' : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:hidden">
        <nav
          aria-label="Primary"
          className="pointer-events-auto mx-auto flex max-w-md items-center gap-1 rounded-[26px] border border-slate-200/80 bg-white/95 p-2 shadow-[0_18px_48px_rgba(15,23,42,0.18)] backdrop-blur"
        >
          {links.map((link) => {
            const href = month && link.monthScoped ? `${link.href}?month=${month}` : link.href;
            const isCurrent = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={href}
                prefetch={false}
                aria-current={isCurrent ? 'page' : undefined}
                className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[20px] px-2 py-2 text-center transition ${
                  isCurrent
                    ? 'bg-brand-50 text-brand-700 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)]'
                    : 'text-slate-500'
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2`}
              >
                <span className={isCurrent ? 'text-brand-700' : 'text-slate-400'}>{link.icon}</span>
                <span className="text-[11px] font-semibold leading-none">{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
