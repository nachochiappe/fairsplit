'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney, formatPercent } from '../../lib/currency';
import {
  updatePersonalBudgetPlan,
  type AppLocale,
  type PersonalBudgetForecastResponse,
} from '../../lib/api';
import { t } from '../../lib/i18n';

interface PersonalAllowanceCardProps {
  forecast: PersonalBudgetForecastResponse;
  locale: AppLocale;
  month: string;
}

interface PlanDraft {
  fixedCommitments: string;
  savingsTarget: string;
  safetyBuffer: string;
  averagingMonths: string;
}

function toDraft(forecast: PersonalBudgetForecastResponse): PlanDraft {
  return {
    fixedCommitments: forecast.settings.fixedCommitments,
    savingsTarget: forecast.settings.savingsTarget,
    safetyBuffer: forecast.settings.safetyBuffer,
    averagingMonths: String(forecast.settings.averagingMonths),
  };
}

function parseAmount(value: string): number {
  return Number(value.trim().replace(',', '.'));
}

export function PersonalAllowanceCard({ forecast, locale, month }: PersonalAllowanceCardProps) {
  const copy = t(locale).dashboard.personalBudget;
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<PlanDraft>(() => toDraft(forecast));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const income = Number(forecast.monthlyIncome);
  const available = Number(forecast.availableForPersonalUse);
  const hasIncome = income > 0;
  const hasShortfall = available < 0;

  useEffect(() => {
    setDraft(toDraft(forecast));
  }, [forecast]);

  const allocations = useMemo(
    () => [
      {
        key: 'shared',
        label: copy.projectedContribution,
        value: Math.max(0, Number(forecast.projectedFairShare)),
        className: 'bg-brand-600',
      },
      {
        key: 'fixed',
        label: copy.fixedCommitments,
        value: Math.max(0, Number(forecast.fixedCommitments)),
        className: 'bg-slate-500',
      },
      {
        key: 'savings',
        label: copy.savingsTarget,
        value: Math.max(0, Number(forecast.savingsTarget)),
        className: 'bg-emerald-500',
      },
      {
        key: 'buffer',
        label: copy.safetyBuffer,
        value: Math.max(0, Number(forecast.safetyBuffer)),
        className: 'bg-amber-400',
      },
      {
        key: 'available',
        label: copy.available,
        value: Math.max(0, available),
        className: 'bg-brand-200',
      },
    ],
    [available, copy, forecast],
  );
  const allocationTotal = allocations.reduce((sum, item) => sum + item.value, 0);
  const allocationScale = Math.max(income, allocationTotal, 1);

  function updateDraft(field: keyof PlanDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
    setStatus(null);
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fixedCommitments = parseAmount(draft.fixedCommitments);
    const savingsTarget = parseAmount(draft.savingsTarget);
    const safetyBuffer = parseAmount(draft.safetyBuffer);
    const averagingMonths = Number(draft.averagingMonths);
    const amounts = [fixedCommitments, savingsTarget, safetyBuffer];

    if (amounts.some((value) => !Number.isFinite(value) || value < 0)) {
      setError(copy.amountError);
      return;
    }
    if (!Number.isInteger(averagingMonths) || averagingMonths < 1 || averagingMonths > 12) {
      setError(copy.lookbackError);
      return;
    }

    setIsSaving(true);
    setError(null);
    setStatus(null);
    try {
      await updatePersonalBudgetPlan({
        enabled: forecast.settings.enabled,
        fixedCommitments,
        savingsTarget,
        safetyBuffer,
        averagingMonths,
      });
      setStatus(copy.saved);
      setIsEditing(false);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-stroke/80 bg-surface shadow-sm">
      <button
        aria-expanded={isExpanded}
        className="flex min-h-16 w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-surface-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600 sm:px-6 md:px-8"
        type="button"
        onClick={() => {
          setIsExpanded((current) => !current);
          if (isExpanded) {
            setIsEditing(false);
          }
        }}
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold text-ink-strong md:text-lg">
            {copy.title}
          </span>
          <span className="mt-0.5 block truncate text-sm text-ink-muted">
            {hasIncome
              ? `${hasShortfall ? copy.shortfall : copy.available}: ${formatMoney(Math.abs(available), locale)}`
              : copy.incomeNeeded}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="hidden min-h-8 items-center gap-2 whitespace-nowrap rounded-full bg-surface-soft px-3 text-xs font-semibold text-brand-700 sm:inline-flex">
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 20 20"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
              <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" />
            </svg>
            {copy.privateLabel}
          </span>
          <svg
            aria-hidden="true"
            className={`h-5 w-5 text-ink-muted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 20 20"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {isExpanded ? (
        <>
          <div className="grid gap-0 border-t border-stroke/70 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <div className="px-5 py-6 sm:px-6 md:px-8 md:py-8">
              {hasIncome ? (
                <div>
                  <p
                    className={`text-sm font-semibold ${hasShortfall ? 'text-rose-700' : 'text-brand-700'}`}
                  >
                    {hasShortfall ? copy.shortfall : copy.available}
                  </p>
                  <p
                    className={`mt-1 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl ${hasShortfall ? 'text-rose-600' : 'text-ink-strong'}`}
                  >
                    {formatMoney(Math.abs(available), locale)}
                  </p>
                  <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-muted">
                    {hasShortfall ? copy.shortfallHelp : copy.availableHelp}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="font-semibold text-ink-strong">{copy.incomeNeeded}</p>
                  <p className="mt-1 text-sm leading-6 text-ink-muted">{copy.incomeNeededHelp}</p>
                  <Link
                    className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand-700 underline decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    href={`/incomes?month=${month}`}
                  >
                    {copy.addIncome}
                  </Link>
                </div>
              )}

              {hasIncome ? (
                <>
                  <div
                    aria-label={copy.allocationAria}
                    className="mt-7 flex h-3 w-full overflow-hidden rounded-full bg-surface-muted"
                    role="img"
                  >
                    {allocations.map((item) =>
                      item.value > 0 ? (
                        <span
                          key={item.key}
                          className={item.className}
                          style={{ width: `${(item.value / allocationScale) * 100}%` }}
                        />
                      ) : null,
                    )}
                  </div>
                  <ul className="mt-4 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
                    {allocations.map((item) => (
                      <li className="flex items-center justify-between gap-3" key={item.key}>
                        <span className="flex min-w-0 items-center gap-2 text-ink-muted">
                          <span
                            aria-hidden="true"
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.className}`}
                          />
                          <span className="truncate">{item.label}</span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-ink-strong">
                          {formatMoney(item.value, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>

            <div className="border-t border-stroke/70 bg-surface-muted/55 px-5 py-6 sm:px-6 md:px-8 md:py-8 lg:border-l lg:border-t-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-ink-strong">{copy.howCalculated}</h3>
                  <p className="mt-1 text-sm leading-6 text-ink-muted">
                    {forecast.historyMonthsUsed === 0
                      ? copy.noHistory
                      : copy.historyUsed(
                          forecast.historyMonthsUsed,
                          forecast.historyMonthsRequested,
                        )}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-full border border-stroke bg-white px-3 py-1 text-xs font-semibold text-ink-muted">
                  {copy.confidence[forecast.confidence]}
                </span>
              </div>

              <dl className="mt-6 space-y-3 text-sm">
                <BudgetLine label={copy.monthlyIncome} locale={locale} value={income} strong />
                <BudgetLine
                  label={copy.projectedContribution}
                  locale={locale}
                  value={-Number(forecast.projectedFairShare)}
                />
                <BudgetLine
                  label={copy.fixedCommitments}
                  locale={locale}
                  value={-Number(forecast.fixedCommitments)}
                />
                <BudgetLine
                  label={copy.savingsTarget}
                  locale={locale}
                  value={-Number(forecast.savingsTarget)}
                />
                <BudgetLine
                  label={copy.safetyBuffer}
                  locale={locale}
                  value={-Number(forecast.safetyBuffer)}
                />
                <div className="border-t border-stroke pt-3">
                  <BudgetLine
                    label={hasShortfall ? copy.shortfall : copy.available}
                    locale={locale}
                    value={available}
                    strong
                  />
                </div>
              </dl>

              <details className="mt-5 border-t border-stroke/70 pt-4 text-sm">
                <summary className="min-h-11 cursor-pointer select-none py-3 font-semibold text-ink-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2">
                  {copy.forecastDetails}
                </summary>
                <dl className="space-y-3 pb-2 pt-2">
                  <BudgetLine
                    label={copy.historicalAverage}
                    locale={locale}
                    value={Number(forecast.historicalAverageSharedExpenses)}
                  />
                  <BudgetLine
                    label={copy.projectedShared}
                    locale={locale}
                    value={Number(forecast.projectedSharedExpenses)}
                  />
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-ink-muted">{copy.yourSplit}</dt>
                    <dd className="font-semibold tabular-nums text-ink-strong">
                      {formatPercent(Number(forecast.splitPercentage) / 100, locale)}
                    </dd>
                  </div>
                  <BudgetLine
                    label={copy.alreadyPaid}
                    locale={locale}
                    value={Number(forecast.alreadyPaid)}
                  />
                  <BudgetLine
                    label={copy.stillToReserve}
                    locale={locale}
                    value={Number(forecast.remainingSharedReserve)}
                  />
                </dl>
              </details>

              <button
                aria-expanded={isEditing}
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-stroke bg-white px-4 py-2 text-sm font-semibold text-ink-base hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                type="button"
                onClick={() => {
                  setIsEditing((current) => !current);
                  setError(null);
                  setStatus(null);
                }}
              >
                {forecast.configured ? copy.adjustPlan : copy.setUpPlan}
              </button>
              {status ? (
                <p className="mt-3 text-sm font-medium text-emerald-700" role="status">
                  {status}
                </p>
              ) : null}
            </div>
          </div>

          {isEditing ? (
            <form
              className="border-t border-stroke bg-white px-5 py-6 sm:px-6 md:px-8"
              onSubmit={savePlan}
            >
              <div className="max-w-3xl">
                <h3 className="text-lg font-semibold text-ink-strong">{copy.planTitle}</h3>
                <p className="mt-1 text-sm leading-6 text-ink-muted">{copy.planHelp}</p>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <PlanField
                  help={copy.fixedCommitmentsHelp}
                  id="personal-fixed-commitments"
                  label={copy.fixedCommitments}
                  value={draft.fixedCommitments}
                  onChange={(value) => updateDraft('fixedCommitments', value)}
                />
                <PlanField
                  help={copy.savingsTargetHelp}
                  id="personal-savings-target"
                  label={copy.savingsTarget}
                  value={draft.savingsTarget}
                  onChange={(value) => updateDraft('savingsTarget', value)}
                />
                <PlanField
                  help={copy.safetyBufferHelp}
                  id="personal-safety-buffer"
                  label={copy.safetyBuffer}
                  value={draft.safetyBuffer}
                  onChange={(value) => updateDraft('safetyBuffer', value)}
                />
                <div>
                  <label
                    className="text-sm font-semibold text-ink-strong"
                    htmlFor="personal-average-months"
                  >
                    {copy.lookback}
                  </label>
                  <input
                    aria-describedby="personal-average-months-help"
                    className="mt-2 min-h-11 w-full rounded-xl border border-stroke bg-white px-4 text-base tabular-nums text-ink-strong focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    id="personal-average-months"
                    inputMode="numeric"
                    max="12"
                    min="1"
                    type="number"
                    value={draft.averagingMonths}
                    onChange={(event) => updateDraft('averagingMonths', event.target.value)}
                  />
                  <p
                    className="mt-2 text-xs leading-5 text-ink-muted"
                    id="personal-average-months-help"
                  >
                    {copy.lookbackHelp}
                  </p>
                </div>
              </div>
              {error ? (
                <p
                  className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  className="min-h-11 rounded-xl border border-stroke bg-white px-5 text-sm font-semibold text-ink-base hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  type="button"
                  onClick={() => {
                    setDraft(toDraft(forecast));
                    setError(null);
                    setIsEditing(false);
                  }}
                >
                  {copy.cancel}
                </button>
                <button
                  className="min-h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? copy.saving : copy.savePlan}
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function BudgetLine({
  label,
  locale,
  strong = false,
  value,
}: {
  label: string;
  locale: AppLocale;
  strong?: boolean;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={strong ? 'font-semibold text-ink-strong' : 'text-ink-muted'}>{label}</dt>
      <dd className={`${strong ? 'font-bold' : 'font-semibold'} tabular-nums text-ink-strong`}>
        {value < 0 ? `−${formatMoney(Math.abs(value), locale)}` : formatMoney(value, locale)}
      </dd>
    </div>
  );
}

function PlanField({
  help,
  id,
  label,
  onChange,
  value,
}: {
  help: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div>
      <label className="text-sm font-semibold text-ink-strong" htmlFor={id}>
        {label}
      </label>
      <div className="relative mt-2">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-ink-muted"
        >
          $
        </span>
        <input
          aria-describedby={`${id}-help`}
          className="min-h-11 w-full rounded-xl border border-stroke bg-white py-2 pl-8 pr-4 text-base tabular-nums text-ink-strong focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          id={id}
          inputMode="decimal"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-ink-muted" id={`${id}-help`}>
        {help}
      </p>
    </div>
  );
}
