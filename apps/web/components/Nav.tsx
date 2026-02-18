'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/incomes', label: 'Incomes' },
  { href: '/expenses', label: 'Expenses' },
  { href: '/settings', label: 'Settings' },
];

export function Nav({ month }: { month: string }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    for (const link of links) {
      const href = month ? `${link.href}?month=${month}` : link.href;
      if (pathname !== link.href) {
        router.prefetch(href);
      }
    }
  }, [month, pathname, router]);

  return (
    <nav
      aria-label="Primary"
      className="mb-8 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-2 shadow-sm backdrop-blur md:grid-cols-5"
    >
      {links.map((link) => {
        const href = month ? `${link.href}?month=${month}` : link.href;
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
            aria-current={isCurrent ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
      <form action="/logout" method="post">
        <button
          type="submit"
          className="rounded-xl px-4 py-3 text-center text-base font-semibold text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Logout
        </button>
      </form>
    </nav>
  );
}
