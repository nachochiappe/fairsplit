'use client';

import { useEffect, useState } from 'react';
import { formatMoney, formatPercent } from '../../lib/currency';
import { type Income, type SettlementResponse, type User } from '../../lib/api';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface DashboardClientProps {
  month: string;
  users: User[];
  incomes: Income[];
  settlement: SettlementResponse;
  expenseCategorySlices?: Array<{
    categoryName: string;
    totalArs: number;
    superCategoryName: string | null;
    superCategoryColor: string | null;
  }>;
  warning?: string | null;
}

export function DashboardClient({ month, users, incomes, settlement, expenseCategorySlices = [], warning }: DashboardClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isCategoryChartExpanded, setIsCategoryChartExpanded] = useState(false);
  const usersById = Object.fromEntries(users.map((user) => [user.id, user]));
  const incomeByUser: Record<string, number> = {};
  for (const income of incomes) {
    incomeByUser[income.userId] = (incomeByUser[income.userId] ?? 0) + Number(income.amountArs);
  }

  const monthLabel = formatMonthLabel(month);
  const onMonthChange = (nextMonth: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('month', nextMonth);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <main id="main-content" className="mx-auto min-h-screen w-full max-w-[1400px] px-4 py-8 md:px-6 md:py-10">
      <header className="mb-7 rounded-3xl border border-slate-200/80 bg-white/75 p-6 shadow-sm backdrop-blur-md md:p-9">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">FairSplit</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-5xl">Settlement Dashboard</h1>
            <p className="mt-2 max-w-2xl text-base text-slate-600">
              See fair monthly contributions and transfer recommendation
            </p>
          </div>
          <div className="min-w-[240px]">
            <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500" htmlFor="month">
              Month
            </label>
            <div className="relative mt-2">
              <input
                id="month"
                aria-label="Select month"
                autoComplete="off"
                className="min-h-11 w-full rounded-xl border border-slate-300/90 bg-white px-4 py-2.5 text-base font-medium leading-tight text-slate-700 shadow-sm [color-scheme:light] [&::-webkit-date-and-time-value]:text-left"
                name="month"
                type="month"
                value={month}
                onChange={(event) => onMonthChange(event.target.value)}
              />
            </div>
            <p className="sr-only">Selected month: {monthLabel}</p>
          </div>
        </div>
      </header>

      <nav
        aria-label="Primary"
        className="mb-8 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-2 shadow-sm backdrop-blur md:grid-cols-5"
      >
        <NavItem href="/dashboard" label="Dashboard" month={month} />
        <NavItem href="/incomes" label="Incomes" month={month} />
        <NavItem href="/expenses" label="Expenses" month={month} />
        <NavItem href="/settings" label="Settings" month={month} />
        <form action="/logout" method="post" className="h-full">
          <button
            type="submit"
            className="h-full w-full rounded-xl px-4 py-3 text-center text-base font-semibold text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Logout
          </button>
        </form>
      </nav>

      <div className="space-y-8">
        {warning ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            <p>{warning}</p>
            <p className="mt-2">
              <Link className="font-semibold underline decoration-2 underline-offset-2" href={`/incomes?month=${month}`}>
                Open incomes
              </Link>
            </p>
          </div>
        ) : null}
        <section className="grid gap-5 md:grid-cols-3">
          <MetricCard label="Total income" value={formatMoney(settlement.totalIncome)} />
          <MetricCard label="Total expenses" value={formatMoney(settlement.totalExpenses)} />
          <MetricCard label="Expense ratio" value={formatPercent(settlement.expenseRatio)} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Expenses by category</h2>
              <p className="mt-1 text-sm text-slate-600">Monthly distribution of expenses in ARS.</p>
            </div>
            <button
              aria-controls="expense-category-chart-content"
              aria-expanded={isCategoryChartExpanded}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              type="button"
              onClick={() => setIsCategoryChartExpanded((current) => !current)}
            >
              {isCategoryChartExpanded ? 'Hide chart' : 'Show chart'}
            </button>
          </div>
          </div>
          {isCategoryChartExpanded ? (
            <div className="p-6 md:p-8" id="expense-category-chart-content">
              <CategoryPieChart slices={expenseCategorySlices} />
            </div>
          ) : null}
        </section>

        <section className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Monthly settlement by partner</caption>
            <thead className="bg-slate-50/85 text-slate-500">
              <tr>
                <th className="px-5 py-4 text-xs font-bold uppercase tracking-[0.14em] md:px-8" scope="col">Partner</th>
                <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-[0.14em] md:px-8" scope="col">
                  Income
                </th>
                <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-[0.14em] md:px-8" scope="col">
                  Paid
                </th>
                <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-[0.14em] md:px-8" scope="col">
                  Fair contribution
                </th>
                <th className="px-5 py-4 text-right text-xs font-bold uppercase tracking-[0.14em] md:px-8" scope="col">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/70">
                  <th className="px-5 py-5 text-left text-lg font-semibold text-slate-900 md:px-8 md:text-xl" scope="row">
                    {user.name}
                  </th>
                  <td className="px-5 py-5 text-right text-lg font-medium tabular-nums text-slate-900 md:px-8">
                    {formatMoney(incomeByUser[user.id] ?? 0)}
                  </td>
                  <td className="px-5 py-5 text-right text-lg font-medium tabular-nums text-slate-900 md:px-8">
                    {formatMoney(settlement.paidByUser[user.id] ?? 0)}
                  </td>
                  <td className="px-5 py-5 text-right text-lg font-medium tabular-nums text-slate-900 md:px-8">
                    {formatMoney(settlement.fairShareByUser[user.id] ?? 0)}
                  </td>
                  <td
                    className={`px-5 py-5 text-right text-lg font-bold tabular-nums md:px-8 ${
                      Number(settlement.differenceByUser[user.id] ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'
                    }`}
                  >
                    {formatMoney(settlement.differenceByUser[user.id] ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-700 via-brand-600 to-[#3f75de] px-6 py-8 text-white shadow-xl shadow-brand-900/15 md:px-9">
          <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-white/15 blur-3xl" />
          <div className="relative z-10">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">Settlement</h2>
            {settlement.transfer ? (
              <div className="mt-3 flex items-start gap-4">
                <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20">
                  <svg
                    aria-hidden="true"
                    className="h-6 w-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M7 7h10M7 7l3-3M7 7l3 3M17 17H7M17 17l-3-3M17 17l-3 3" />
                  </svg>
                </div>
                <p className="text-2xl leading-snug md:text-4xl">
                  <span className="font-normal text-blue-50/90">
                    {usersById[settlement.transfer.fromUserId]?.name ?? settlement.transfer.fromUserId} sends
                  </span>{' '}
                  <span className="font-semibold">{formatMoney(settlement.transfer.amount)}</span>{' '}
                  <span className="font-normal text-blue-50/90">
                    to {usersById[settlement.transfer.toUserId]?.name ?? settlement.transfer.toUserId}
                  </span>
                </p>
              </div>
            ) : (
              <p className="mt-3 text-2xl font-semibold md:text-3xl">No transfer needed</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-2 text-4xl font-bold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

function NavItem({ href, label, month }: { href: string; label: string; month: string }) {
  const pathname = usePathname();
  const fullHref = `${href}?month=${month}`;
  const isCurrent = pathname === href;

  return (
    <Link
      className={`rounded-xl px-4 py-3 text-center text-base font-semibold ${
        isCurrent ? 'bg-brand-600 text-white shadow-md shadow-brand-700/25' : 'text-slate-500 hover:text-slate-800'
      }`}
      href={fullHref}
      aria-current={isCurrent ? 'page' : undefined}
    >
      {label}
    </Link>
  );
}

function formatMonthLabel(month: string): string {
  const [yearRaw, monthRaw] = month.split('-');
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);

  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) {
    return month;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, monthNumber - 1, 1));
}

function formatCountLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function CategoryPieChart({
  slices,
}: {
  slices: Array<{
    categoryName: string;
    totalArs: number;
    superCategoryName: string | null;
    superCategoryColor: string | null;
  }>;
}) {
  const groups = buildSuperCategoryGroups(slices);
  const [expandedGroupName, setExpandedGroupName] = useState<string | null>(groups[0]?.name ?? null);
  const groupedTotals = groups.map((group) => ({ categoryName: group.name, totalArs: group.totalArs, color: group.color }));
  const chartSize = 320;
  const radius = 125;
  const innerRadius = 92;
  const center = chartSize / 2;
  const total = groupedTotals.reduce((sum, slice) => sum + slice.totalArs, 0);

  useEffect(() => {
    if (expandedGroupName !== null && !groups.some((group) => group.name === expandedGroupName)) {
      setExpandedGroupName(groups[0]?.name ?? null);
    }
  }, [expandedGroupName, groups]);

  if (slices.length === 0) {
    return <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">No expenses available for this month.</p>;
  }

  let startAngle = -Math.PI / 2;
  const segments = groupedTotals.map((slice) => {
    const angle = (slice.totalArs / total) * Math.PI * 2;
    const endAngle = startAngle + angle;
    const largeArcFlag = angle > Math.PI ? 1 : 0;
    const x1 = center + radius * Math.cos(startAngle);
    const y1 = center + radius * Math.sin(startAngle);
    const x2 = center + radius * Math.cos(endAngle);
    const y2 = center + radius * Math.sin(endAngle);
    const path = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
    startAngle = endAngle;

    return {
      ...slice,
      path,
      percentage: total === 0 ? 0 : (slice.totalArs / total) * 100,
    };
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
        <div className="relative mx-auto w-fit">
          <svg aria-label="Pie chart showing expenses by category" className="mx-auto" height={chartSize} role="img" viewBox={`0 0 ${chartSize} ${chartSize}`} width={chartSize}>
            {segments.map((segment) => (
              <path key={segment.categoryName} d={segment.path} fill={segment.color} />
            ))}
            <circle cx={center} cy={center} fill="white" r={innerRadius} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Total spent</p>
            <p className="mt-1 text-5xl font-bold leading-none text-slate-900">{formatCompactMoney(total)}</p>
          </div>
        </div>
        <ul className="mx-auto mt-5 max-w-sm space-y-2">
          {segments.map((segment) => (
            <li key={segment.categoryName} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-700">
                <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: segment.color }} />
                <span className="font-medium">{segment.categoryName}</span>
              </div>
              <span className="font-semibold tabular-nums text-slate-900">{segment.percentage.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>

      <ul className="space-y-4">
        {groups.map((group) => (
          <li key={group.name}>
            <button
              aria-controls={`super-category-panel-${group.name}`}
              aria-expanded={expandedGroupName === group.name}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-1 text-left"
              type="button"
              onClick={() => setExpandedGroupName((current) => (current === group.name ? null : group.name))}
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${group.color}22` }}
                >
                  <SuperCategoryIcon color={group.color} name={group.name} />
                </span>
                <div>
                  <p className="text-xl font-semibold leading-tight text-slate-900">{group.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatCountLabel(group.categories.length, 'category', 'categories')} • {formatMoney(group.totalArs)}
                  </p>
                </div>
              </div>
              <svg
                aria-hidden="true"
                className={`h-5 w-5 text-slate-500 transition-transform ${
                  expandedGroupName === group.name ? 'rotate-180' : 'rotate-0'
                }`}
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 8l5 5 5-5" />
              </svg>
            </button>
            {expandedGroupName === group.name ? (
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4" id={`super-category-panel-${group.name}`}>
                <ul className="space-y-3">
                  {group.categories.map((category) => (
                    <li key={category.categoryName}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color }} />
                          <span className="font-medium text-slate-700">{category.categoryName}</span>
                        </div>
                        <span className="font-semibold tabular-nums text-slate-900">{formatMoney(category.totalArs)}</span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full"
                          style={{ backgroundColor: group.color, width: `${Math.max((category.totalArs / total) * 100, 2)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-right text-xs font-medium text-slate-500">
                        {((category.totalArs / total) * 100).toFixed(1)}% of total
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-500 lg:col-span-2">
        Showing data from{' '}
        <span className="font-semibold text-slate-700">{formatCountLabel(slices.length, 'category', 'categories')}</span>{' '}
        across{' '}
        <span className="font-semibold text-slate-700">{groups.length}</span> groups.
      </p>
    </div>
  );
}

function buildSuperCategoryGroups(
  slices: Array<{
    categoryName: string;
    totalArs: number;
    superCategoryName: string | null;
    superCategoryColor: string | null;
  }>,
): Array<{
  name: string;
  color: string;
  totalArs: number;
  categories: Array<{ categoryName: string; totalArs: number }>;
}> {
  const colorBySuperCategory: Record<string, string> = {
    Housing: '#4f46e5',
    Lifestyle: '#10b981',
    Essentials: '#f59e0b',
    Mobility: '#0891b2',
    Finance: '#7c3aed',
    Other: '#64748b',
  };

  const grouped = new Map<
    string,
    {
      name: string;
      color: string;
      totalArs: number;
      categories: Array<{ categoryName: string; totalArs: number }>;
    }
  >();

  for (const slice of slices) {
    const superCategory = slice.superCategoryName ?? 'Unassigned';
    const existing = grouped.get(superCategory) ?? {
      name: superCategory,
      color: slice.superCategoryColor ?? colorBySuperCategory[superCategory] ?? colorBySuperCategory.Other,
      totalArs: 0,
      categories: [],
    };

    existing.totalArs += slice.totalArs;
    existing.categories.push(slice);
    grouped.set(superCategory, existing);
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      categories: group.categories.sort((a, b) => b.totalArs - a.totalArs),
    }))
    .sort((a, b) => b.totalArs - a.totalArs);
}

function formatCompactMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function SuperCategoryIcon({ name, color }: { name: string; color: string }) {
  const commonProps = {
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (name === 'Housing') {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20">
        <path {...commonProps} d="M3 9.5l7-5.5 7 5.5" />
        <path {...commonProps} d="M5.5 8.5V16h9V8.5" />
        <path {...commonProps} d="M8.5 16v-3.5h3V16" />
      </svg>
    );
  }
  if (name === 'Lifestyle') {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20">
        <path {...commonProps} d="M10 16.5s-4.8-2.7-6.2-6.4c-.8-2 1-4.1 3.1-4.1 1.3 0 2.5.7 3.1 1.8.6-1.1 1.8-1.8 3.1-1.8 2.1 0 3.9 2.1 3.1 4.1-1.4 3.7-6.2 6.4-6.2 6.4z" />
      </svg>
    );
  }
  if (name === 'Essentials') {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20">
        <path {...commonProps} d="M3 5.5h2l1.3 6.2a1 1 0 001 .8h6.8a1 1 0 001-.7L17 7H6.2" />
        <circle cx="8.2" cy="14.8" r="1" fill={color} />
        <circle cx="13.6" cy="14.8" r="1" fill={color} />
      </svg>
    );
  }
  if (name === 'Mobility') {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20">
        <path {...commonProps} d="M4 11.5h12l-1.2-4.2a1.2 1.2 0 00-1.1-.8H6.3a1.2 1.2 0 00-1.1.8L4 11.5z" />
        <path {...commonProps} d="M4 11.5V14m12-2.5V14" />
        <circle cx="6.8" cy="14.3" r="1.3" fill={color} />
        <circle cx="13.2" cy="14.3" r="1.3" fill={color} />
      </svg>
    );
  }
  if (name === 'Finance') {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20">
        <rect {...commonProps} x="3.5" y="6" width="13" height="8" rx="1.5" />
        <circle {...commonProps} cx="10" cy="10" r="1.8" />
        <path {...commonProps} d="M6 10h.01M14 10h.01" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20">
      <circle cx="10" cy="10" fill={color} r="3.5" />
      <path {...commonProps} d="M10 3.5v2.2M10 14.3v2.2M3.5 10h2.2M14.3 10h2.2M5.3 5.3l1.6 1.6M13.1 13.1l1.6 1.6M14.7 5.3l-1.6 1.6M6.9 13.1l-1.6 1.6" />
    </svg>
  );
}
