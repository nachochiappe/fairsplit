'use client';

import type { CategoryIconKey } from '@fairsplit/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryIcon } from '../../components/CategoryIcon';
import { formatMoney, formatPercent } from '../../lib/currency';
import {
  materializeExpenseMonth,
  type AppLocale,
  type Income,
  type SettlementResponse,
  type User,
} from '../../lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MonthNavigationPendingProvider,
  useMonthNavigationPending,
} from '../../components/MonthNavigationPending';
import { MonthSelector } from '../../components/MonthSelector';
import { Nav } from '../../components/Nav';
import { TitleMark } from '../../components/TitleMark';
import { LocaleSync } from '../../components/LocaleSync';
import { getSuperCategoryAccentColor } from '../../lib/theme';
import { formatCountLabel, localeTags, t } from '../../lib/i18n';

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
    superCategoryIcon: CategoryIconKey | null;
  }>;
  warning?: string | null;
  locale: AppLocale;
}

export function DashboardClient({
  month,
  users,
  incomes,
  settlement,
  expenseCategorySlices = [],
  warning,
  locale,
}: DashboardClientProps) {
  return (
    <MonthNavigationPendingProvider>
      <DashboardClientContent
        month={month}
        users={users}
        incomes={incomes}
        settlement={settlement}
        expenseCategorySlices={expenseCategorySlices}
        warning={warning}
        locale={locale}
      />
    </MonthNavigationPendingProvider>
  );
}

function DashboardClientContent({
  month,
  users,
  incomes,
  settlement,
  expenseCategorySlices = [],
  warning,
  locale,
}: DashboardClientProps) {
  const [isCategoryChartExpanded, setIsCategoryChartExpanded] = useState(false);
  const [materializationMessage, setMaterializationMessage] = useState<string | null>(null);
  const materializedMonthRef = useRef<string | null>(null);
  const router = useRouter();
  const { isPending } = useMonthNavigationPending();
  const copy = t(locale).dashboard;
  const usersById = Object.fromEntries(users.map((user) => [user.id, user]));
  const incomeByUser: Record<string, number> = {};
  for (const income of incomes) {
    incomeByUser[income.userId] = (incomeByUser[income.userId] ?? 0) + Number(income.amountArs);
  }

  useEffect(() => {
    if (materializedMonthRef.current === month) {
      return;
    }
    materializedMonthRef.current = month;

    let cancelled = false;
    void materializeExpenseMonth(month)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setMaterializationMessage(result.warnings.length > 0 ? result.warnings.join(' ') : null);
        router.refresh();
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        materializedMonthRef.current = null;
        setMaterializationMessage(
          error instanceof Error ? error.message : 'Failed to prepare monthly expenses.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [month, router]);

  return (
    <main
      id="main-content"
      className="mx-auto min-h-screen w-full max-w-[1400px] px-4 pb-28 pt-3 md:px-6 md:pb-10 md:pt-7"
    >
      <header className="mb-3 md:mb-5 md:rounded-3xl md:border md:border-stroke/80 md:bg-surface md:px-6 md:py-4 md:shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="flex items-center gap-3 md:gap-4">
            <TitleMark className="h-9 w-9 shrink-0 rounded-xl md:h-10 md:w-10" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">
                Fairsplit
              </p>
              <div className="md:mt-1 md:flex md:items-baseline md:gap-3">
                <h1 className="text-xl font-bold tracking-tight text-ink-strong md:text-3xl">
                  <span className="md:hidden">{t(locale).nav.dashboard}</span>
                  <span className="hidden md:inline">{copy.title}</span>
                </h1>
                <p className="hidden max-w-2xl text-sm text-ink-muted md:mt-0 md:block">
                  {copy.subtitle}
                </p>
              </div>
            </div>
          </div>
          <MonthSelector month={month} locale={locale} mobileCompact />
        </div>
      </header>

      <LocaleSync locale={locale} />
      <Nav month={month} locale={locale} />

      <div
        aria-busy={isPending}
        className={`space-y-8 transition duration-200 ${
          isPending ? 'pointer-events-none select-none blur-[3px] opacity-70' : 'opacity-100'
        }`}
      >
        {warning ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            <p>{warning}</p>
            <p className="mt-2">
              <Link
                className="font-semibold underline decoration-2 underline-offset-2"
                href={`/incomes?month=${month}`}
              >
                {copy.openIncomes}
              </Link>
            </p>
          </div>
        ) : null}
        {materializationMessage ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            {materializationMessage}
          </p>
        ) : null}
        <section className="grid gap-5 md:grid-cols-3">
          <MetricCard
            label={copy.totalIncome}
            value={formatMoney(settlement.totalIncome, locale)}
          />
          <MetricCard
            label={copy.totalExpenses}
            value={formatMoney(settlement.totalExpenses, locale)}
          />
          <MetricCard
            label={copy.expenseRatio}
            value={formatPercent(settlement.expenseRatio, locale)}
          />
        </section>

        <section className="overflow-hidden rounded-2xl border border-stroke/80 bg-surface shadow-sm">
          <div className="border-b border-stroke/60 p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-ink-strong">{copy.expensesByCategory}</h2>
                <p className="mt-1 text-sm text-ink-muted">{copy.categoryDistribution}</p>
              </div>
              <button
                aria-controls="expense-category-chart-content"
                aria-expanded={isCategoryChartExpanded}
                className="min-h-11 rounded-lg border border-stroke px-3 py-2 text-sm font-medium text-ink-base hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                type="button"
                onClick={() => setIsCategoryChartExpanded((current) => !current)}
              >
                <span className="truncate">
                  {isCategoryChartExpanded ? copy.hideChart : copy.showChart}
                </span>
              </button>
            </div>
          </div>
          {isCategoryChartExpanded ? (
            <div className="p-6 md:p-8" id="expense-category-chart-content">
              <CategoryPieChart locale={locale} slices={expenseCategorySlices} />
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-stroke/80 bg-surface shadow-sm">
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-8">
            <div>
              <h2 className="text-lg font-semibold text-ink-strong">
                {copy.contributionBreakdown}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {settlement.splitMethod === 'custom'
                  ? copy.customSplitActive
                  : copy.incomeSplitActive}
              </p>
            </div>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-stroke bg-white px-4 py-2 text-sm font-semibold text-ink-base hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              href="/settings"
            >
              {copy.changeSplit}
            </Link>
          </div>
          <div className="divide-y divide-stroke/60 border-t border-stroke/60 md:hidden">
            {users.map((user) => {
              const difference = Number(settlement.differenceByUser[user.id] ?? 0);
              const isPositiveDifference = difference >= 0;
              const absoluteDifference = Math.abs(difference);

              return (
                <article key={user.id} className="space-y-4 px-5 py-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-semibold text-ink-strong">{user.name}</h3>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        isPositiveDifference
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {isPositiveDifference ? copy.overpaid : copy.needsToSend}
                    </span>
                  </div>
                  <div className="rounded-2xl border border-stroke bg-surface-muted/70 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft">
                      {copy.difference}
                    </p>
                    <p
                      className={`mt-2 text-3xl font-semibold tabular-nums ${isPositiveDifference ? 'text-emerald-600' : 'text-rose-500'}`}
                    >
                      {formatMoney(absoluteDifference, locale)}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {isPositiveDifference ? copy.coveredMore : copy.needsToSendThisMonth}
                    </p>
                  </div>
                  <dl className="space-y-3 border-t border-stroke/60 pt-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-ink-muted">{copy.income}</dt>
                      <dd className="font-medium tabular-nums text-ink-strong">
                        {formatMoney(incomeByUser[user.id] ?? 0, locale)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-ink-muted">{copy.paid}</dt>
                      <dd className="font-medium tabular-nums text-ink-strong">
                        {formatMoney(settlement.paidByUser[user.id] ?? 0, locale)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-ink-muted">{copy.fairShare}</dt>
                      <dd className="font-medium tabular-nums text-ink-strong">
                        {formatMoney(settlement.fairShareByUser[user.id] ?? 0, locale)}
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto border-t border-stroke/60 md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">{copy.caption}</caption>
              <thead className="bg-surface-muted/85 text-ink-soft">
                <tr>
                  <th
                    className="px-5 py-4 text-xs font-bold uppercase tracking-[0.14em] md:px-8"
                    scope="col"
                  >
                    {copy.partner}
                  </th>
                  <th
                    className="px-5 py-4 text-right text-xs font-bold uppercase tracking-[0.14em] md:px-8"
                    scope="col"
                  >
                    {copy.income}
                  </th>
                  <th
                    className="px-5 py-4 text-right text-xs font-bold uppercase tracking-[0.14em] md:px-8"
                    scope="col"
                  >
                    {copy.paid}
                  </th>
                  <th
                    className="px-5 py-4 text-right text-xs font-bold uppercase tracking-[0.14em] md:px-8"
                    scope="col"
                  >
                    {copy.fairContribution}
                  </th>
                  <th
                    className="px-5 py-4 text-right text-xs font-bold uppercase tracking-[0.14em] md:px-8"
                    scope="col"
                  >
                    {copy.difference}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stroke/60">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-surface-muted/70">
                    <th
                      className="px-5 py-5 text-left text-lg font-semibold text-ink-strong md:px-8 md:text-xl"
                      scope="row"
                    >
                      {user.name}
                    </th>
                    <td className="px-5 py-5 text-right text-lg font-medium tabular-nums text-ink-strong md:px-8">
                      {formatMoney(incomeByUser[user.id] ?? 0, locale)}
                    </td>
                    <td className="px-5 py-5 text-right text-lg font-medium tabular-nums text-ink-strong md:px-8">
                      {formatMoney(settlement.paidByUser[user.id] ?? 0, locale)}
                    </td>
                    <td className="px-5 py-5 text-right text-lg font-medium tabular-nums text-ink-strong md:px-8">
                      {formatMoney(settlement.fairShareByUser[user.id] ?? 0, locale)}
                    </td>
                    <td
                      className={`px-5 py-5 text-right text-lg font-bold tabular-nums md:px-8 ${
                        Number(settlement.differenceByUser[user.id] ?? 0) >= 0
                          ? 'text-emerald-600'
                          : 'text-rose-500'
                      }`}
                    >
                      {formatMoney(settlement.differenceByUser[user.id] ?? 0, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-brand-200 bg-brand-50 px-6 py-7 shadow-sm md:px-9">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">
            {copy.settlement}
          </h2>
          {settlement.transfer ? (
            <div className="mt-3 space-y-2">
              <p className="text-2xl font-semibold leading-snug text-ink-strong md:text-3xl">
                {copy.transferSentence(
                  usersById[settlement.transfer.fromUserId]?.name ?? settlement.transfer.fromUserId,
                  formatMoney(settlement.transfer.amount, locale),
                  usersById[settlement.transfer.toUserId]?.name ?? settlement.transfer.toUserId,
                )}
              </p>
              <p className="text-sm text-ink-muted">{copy.transferBalances}</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-2xl font-semibold text-ink-strong md:text-3xl">
                {copy.noTransferNeeded}
              </p>
              <p className="text-sm text-ink-muted">{copy.alreadyBalanced}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-stroke/80 bg-surface p-6 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-ink-soft">{label}</p>
      <p className="mt-2 text-4xl font-bold tracking-tight text-ink-strong">{value}</p>
    </div>
  );
}

function CategoryPieChart({
  locale,
  slices,
}: {
  locale: AppLocale;
  slices: Array<{
    categoryName: string;
    totalArs: number;
    superCategoryName: string | null;
    superCategoryColor: string | null;
    superCategoryIcon: CategoryIconKey | null;
  }>;
}) {
  const copy = t(locale).dashboard;
  const unassignedLabel = t(locale).common.unassigned;
  const groups = useMemo(
    () => buildSuperCategoryGroups(slices, unassignedLabel),
    [slices, unassignedLabel],
  );
  const [expandedGroupName, setExpandedGroupName] = useState<string | null>(
    groups[0]?.name ?? null,
  );
  const groupedTotals = useMemo(
    () =>
      groups.map((group) => ({
        categoryName: group.name,
        totalArs: group.totalArs,
        color: group.color,
      })),
    [groups],
  );
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
    return (
      <p className="mt-4 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink-muted">
        {copy.noExpenses}
      </p>
    );
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
  const topSegments = [...segments]
    .sort((left, right) => right.totalArs - left.totalArs)
    .slice(0, 3);
  const leadSegment = topSegments[0];
  const chartSummary = leadSegment
    ? copy.chartSummary(leadSegment.categoryName, leadSegment.percentage.toFixed(1))
    : copy.fallbackChartSummary;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-xl border border-stroke/60 bg-surface-muted/60 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {copy.chartSummaryLabel}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-base">{chartSummary}</p>
          <ol className="mt-3 space-y-2">
            {topSegments.map((segment, index) => (
              <li
                key={segment.categoryName}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-ink-strong">
                    {index + 1}. {segment.categoryName}
                  </p>
                  <p className="text-ink-muted">
                    {copy.amountSpent(formatMoney(segment.totalArs, locale))}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-ink-strong">
                  {segment.percentage.toFixed(1)}%
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="relative mx-auto w-full max-w-[320px]">
          <svg
            aria-describedby="expense-category-chart-summary"
            aria-label={copy.chartAriaLabel}
            className="w-full"
            role="img"
            viewBox={`0 0 ${chartSize} ${chartSize}`}
          >
            {segments.map((segment) => (
              <path key={segment.categoryName} d={segment.path} fill={segment.color}>
                <title>{`${segment.categoryName}: ${segment.percentage.toFixed(1)}%`}</title>
              </path>
            ))}
            <circle cx={center} cy={center} fill="white" r={innerRadius} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-muted">
              {copy.totalSpent}
            </p>
            <p className="mt-1 text-3xl font-bold leading-none text-ink-strong sm:text-5xl">
              {formatCompactMoney(total, locale)}
            </p>
          </div>
        </div>
        <p className="sr-only" id="expense-category-chart-summary">
          {segments
            .map((segment) => `${segment.categoryName}: ${segment.percentage.toFixed(1)}%`)
            .join('. ')}
        </p>
        <ul className="mx-auto max-w-sm space-y-2">
          {segments.map((segment) => (
            <li
              key={segment.categoryName}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <div className="flex items-center gap-2 text-ink-base">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="font-medium">{segment.categoryName}</span>
              </div>
              <span className="font-semibold tabular-nums text-ink-strong">
                {segment.percentage.toFixed(1)}%
              </span>
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
              onClick={() =>
                setExpandedGroupName((current) => (current === group.name ? null : group.name))
              }
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${group.color}22`, color: group.color }}
                >
                  <CategoryIcon className="h-5 w-5" icon={group.icon} />
                </span>
                <div>
                  <p className="text-xl font-semibold leading-tight text-ink-strong">
                    {group.name}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {formatCountLabel(
                      locale,
                      group.categories.length,
                      copy.categorySingular,
                      copy.categoryPlural,
                    )}
                    {' \u2022 '}
                    {formatMoney(group.totalArs, locale)}
                  </p>
                </div>
              </div>
              <svg
                aria-hidden="true"
                className={`h-5 w-5 text-ink-muted transition-transform ${
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
              <div
                className="mt-3 rounded-xl border border-stroke/60 bg-surface-muted/60 p-4"
                id={`super-category-panel-${group.name}`}
              >
                <ul className="space-y-3">
                  {group.categories.map((category) => (
                    <li key={category.categoryName}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          <span className="font-medium text-ink-base">{category.categoryName}</span>
                        </div>
                        <span className="font-semibold tabular-nums text-ink-strong">
                          {formatMoney(category.totalArs, locale)}
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stroke">
                        <div
                          className="h-full rounded-full"
                          style={{
                            backgroundColor: group.color,
                            width: `${Math.max((category.totalArs / total) * 100, 2)}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1 text-right text-xs font-medium text-ink-muted">
                        {copy.percentOfTotal(((category.totalArs / total) * 100).toFixed(1))}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted lg:col-span-2">
        {copy.showingFrom(
          formatCountLabel(locale, slices.length, copy.categorySingular, copy.categoryPlural),
          groups.length,
        )}
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
    superCategoryIcon: CategoryIconKey | null;
  }>,
  unassignedLabel: string,
): Array<{
  name: string;
  color: string;
  icon: CategoryIconKey;
  totalArs: number;
  categories: Array<{ categoryName: string; totalArs: number }>;
}> {
  const grouped = new Map<
    string,
    {
      name: string;
      color: string;
      icon: CategoryIconKey;
      totalArs: number;
      categories: Array<{ categoryName: string; totalArs: number }>;
    }
  >();

  for (const slice of slices) {
    const superCategory = slice.superCategoryName ?? unassignedLabel;
    const existing = grouped.get(superCategory) ?? {
      name: superCategory,
      color: getSuperCategoryAccentColor(superCategory, slice.superCategoryColor),
      icon: slice.superCategoryIcon ?? 'dots',
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

function formatCompactMoney(value: number, locale: AppLocale): string {
  return `$${new Intl.NumberFormat(localeTags[locale], {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)}`;
}
