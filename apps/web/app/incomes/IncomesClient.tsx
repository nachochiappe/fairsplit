'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { MonthSelector } from '../../components/MonthSelector';
import { ViewportModal } from '../../components/ViewportModal';
import {
  getIncomes,
  replaceIncomesForUser,
  type AppLocale,
  type ExchangeRate,
  type Income,
  type User,
} from '../../lib/api';
import { localeTags, t } from '../../lib/i18n';
import {
  IncomeEntryForm,
  supportedIncomeCurrencyCodes,
  type IncomeCurrencyCode,
  type IncomeDraft,
} from './IncomeEntryForm';

interface IncomesClientProps {
  month: string;
  initialUsers: User[];
  initialIncomes: Income[];
  initialExchangeRates: ExchangeRate[];
  locale: AppLocale;
}

interface ActiveIncomeEditor {
  draft: IncomeDraft;
  index: number | null;
  userId: string;
}

interface PendingIncomeRemoval {
  description: string;
  index: number;
  userId: string;
}

const partnerToneClasses = [
  {
    avatar: 'border-rose-200 bg-rose-100 text-rose-700',
    segment: 'bg-rose-500',
  },
  {
    avatar: 'border-fuchsia-200 bg-fuchsia-100 text-fuchsia-700',
    segment: 'bg-violet-600',
  },
  {
    avatar: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    segment: 'bg-emerald-600',
  },
  {
    avatar: 'border-cyan-200 bg-cyan-100 text-cyan-700',
    segment: 'bg-cyan-600',
  },
  {
    avatar: 'border-amber-200 bg-amber-100 text-amber-700',
    segment: 'bg-amber-500',
  },
  {
    avatar: 'border-indigo-200 bg-indigo-100 text-indigo-700',
    segment: 'bg-indigo-600',
  },
] as const;

function toSupportedCurrencyCode(value: string): IncomeCurrencyCode {
  const normalized = value.trim().toUpperCase();
  return supportedIncomeCurrencyCodes.includes(normalized as IncomeCurrencyCode)
    ? (normalized as IncomeCurrencyCode)
    : 'ARS';
}

function getPreviousMonth(month: string): string {
  const [yearPart, monthPart] = month.split('-');
  const date = new Date(Date.UTC(Number(yearPart), Number(monthPart) - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(month: string, locale: AppLocale, includeYear = true): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    month: 'long',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00.000Z`));
}

function formatArs(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(localeTags[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRate(value: string, locale: AppLocale): string {
  return new Intl.NumberFormat(localeTags[locale], {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(Number(value));
}

function formatPercentage(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(localeTags[locale], {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function getUserInitial(name: string): string {
  const trimmedName = name.trim();
  return trimmedName.length > 0 ? trimmedName[0]!.toUpperCase() : '?';
}

function getPartnerTone(index: number): (typeof partnerToneClasses)[number] {
  return partnerToneClasses[index % partnerToneClasses.length]!;
}

function buildIncomeDrafts(users: User[], incomes: Income[]): Record<string, IncomeDraft[]> {
  const nextDrafts: Record<string, IncomeDraft[]> = Object.fromEntries(
    users.map((user) => [user.id, []]),
  );

  for (const income of incomes) {
    if (!nextDrafts[income.userId]) {
      nextDrafts[income.userId] = [];
    }

    const currencyCode = toSupportedCurrencyCode(income.currencyCode);
    nextDrafts[income.userId]!.push({
      id: income.id,
      amount: Number(income.amountOriginal).toFixed(2),
      currencyCode,
      description: income.description,
      fxRate: currencyCode === 'ARS' ? '1' : income.fxRateUsed,
    });
  }

  return nextDrafts;
}

function mergeExchangeRatesFromIncomes(
  previousRates: ExchangeRate[],
  incomes: Income[],
  month: string,
): ExchangeRate[] {
  const nextRates = [...previousRates];

  for (const income of incomes) {
    if (income.currencyCode === 'ARS') {
      continue;
    }

    const existingIndex = nextRates.findIndex((rate) => rate.currencyCode === income.currencyCode);
    const nextRate: ExchangeRate = {
      id: existingIndex >= 0 ? nextRates[existingIndex]!.id : `local-${income.currencyCode}`,
      currencyCode: income.currencyCode,
      month,
      rateToArs: income.fxRateUsed,
    };

    if (existingIndex >= 0) {
      nextRates[existingIndex] = nextRate;
    } else {
      nextRates.push(nextRate);
    }
  }

  return nextRates;
}

function ConfirmationDialog({
  busy,
  cancelLabel,
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  title,
}: {
  busy: boolean;
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <ViewportModal onDismiss={busy ? undefined : onCancel}>
      <div
        aria-labelledby="income-confirmation-dialog-title"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        role="dialog"
      >
        <h3 className="text-lg font-bold text-ink-strong" id="income-confirmation-dialog-title">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{message}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:opacity-60"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ViewportModal>
  );
}

export function IncomesClient({
  month,
  initialUsers,
  initialIncomes,
  initialExchangeRates,
  locale,
}: IncomesClientProps) {
  const copy = t(locale).incomes;
  const shared = t(locale).common;
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>(initialExchangeRates);
  const [incomeDraftsByUser, setIncomeDraftsByUser] = useState<Record<string, IncomeDraft[]>>(() =>
    buildIncomeDrafts(initialUsers, initialIncomes),
  );
  const [editor, setEditor] = useState<ActiveIncomeEditor | null>(null);
  const [pendingIncomeRemoval, setPendingIncomeRemoval] = useState<PendingIncomeRemoval | null>(
    null,
  );
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [copyingPrevious, setCopyingPrevious] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUsers(initialUsers);
    setIncomeDraftsByUser(buildIncomeDrafts(initialUsers, initialIncomes));
    setExchangeRates(initialExchangeRates);
    setEditor(null);
    setPendingIncomeRemoval(null);
    setMessage(null);
    setError(null);
  }, [initialExchangeRates, initialIncomes, initialUsers]);

  const previousMonth = useMemo(() => getPreviousMonth(month), [month]);
  const monthRateByCurrency = useMemo(
    () => new Map(exchangeRates.map((rate) => [rate.currencyCode, Number(rate.rateToArs)])),
    [exchangeRates],
  );

  const parseIncomeAmountToArs = useCallback(
    (draft: IncomeDraft): number => {
      const amount = Number(draft.amount);
      if (!Number.isFinite(amount)) {
        return 0;
      }

      const savedMonthRate = monthRateByCurrency.get(draft.currencyCode);
      const fxRate =
        draft.currencyCode === 'ARS' ? 1 : Number(draft.fxRate || savedMonthRate || NaN);
      return Number.isFinite(fxRate) ? amount * fxRate : 0;
    },
    [monthRateByCurrency],
  );

  const totalByUser = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const user of users) {
      totals[user.id] = (incomeDraftsByUser[user.id] ?? []).reduce(
        (sum, draft) => sum + parseIncomeAmountToArs(draft),
        0,
      );
    }
    return totals;
  }, [incomeDraftsByUser, parseIncomeAmountToArs, users]);

  const total = useMemo(
    () => users.reduce((sum, user) => sum + (totalByUser[user.id] ?? 0), 0),
    [totalByUser, users],
  );

  const partnerSummaries = useMemo(() => {
    const positiveTotal = users.reduce(
      (sum, user) => sum + Math.max(totalByUser[user.id] ?? 0, 0),
      0,
    );
    return users.map((user, index) => {
      const userTotal = totalByUser[user.id] ?? 0;
      return {
        percentage: total === 0 ? 0 : (userTotal / total) * 100,
        tone: getPartnerTone(index),
        user,
        userTotal,
        visualPercentage:
          positiveTotal === 0
            ? 100 / Math.max(users.length, 1)
            : (Math.max(userTotal, 0) / positiveTotal) * 100,
      };
    });
  }, [total, totalByUser, users]);

  const isBusy = savingUserId !== null || copyingPrevious;

  const openAddIncome = (userId: string) => {
    setError(null);
    setMessage(null);
    setEditor({
      draft: { amount: '', currencyCode: 'ARS', description: '', fxRate: '1' },
      index: null,
      userId,
    });
  };

  const openEditIncome = (userId: string, index: number) => {
    const draft = incomeDraftsByUser[userId]?.[index];
    if (!draft) {
      return;
    }
    setError(null);
    setMessage(null);
    setEditor({ draft: { ...draft }, index, userId });
  };

  const buildPayload = (user: User, rows: IncomeDraft[]) => {
    const entries: Array<{
      description: string;
      amount: number;
      currencyCode: string;
      fxRate?: number;
    }> = [];

    for (const row of rows) {
      const description = row.description.trim();
      if (!description) {
        return { error: copy.descriptionRequired(user.name), entries: null };
      }
      if (!row.amount.trim()) {
        return { error: copy.amountRequired(user.name), entries: null };
      }

      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) {
        return { error: copy.amountInvalid(user.name), entries: null };
      }

      const fxRate =
        row.currencyCode === 'ARS' || !row.fxRate.trim() ? undefined : Number(row.fxRate);
      if (
        row.currencyCode !== 'ARS' &&
        (fxRate === undefined || !Number.isFinite(fxRate) || fxRate <= 0)
      ) {
        return { error: copy.fxRateInvalid(user.name), entries: null };
      }

      entries.push({
        amount,
        currencyCode: row.currencyCode,
        description,
        ...(fxRate === undefined ? {} : { fxRate }),
      });
    }

    return { error: null, entries };
  };

  const persistUserRows = async (
    userId: string,
    rows: IncomeDraft[],
    successMessage: string,
  ): Promise<boolean> => {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
      return false;
    }

    const payload = buildPayload(user, rows);
    if (!payload.entries) {
      setError(payload.error);
      return false;
    }

    try {
      setSavingUserId(userId);
      setError(null);
      setMessage(null);
      const savedIncomes = await replaceIncomesForUser({ month, userId, entries: payload.entries });
      const savedRows = buildIncomeDrafts([user], savedIncomes)[userId] ?? [];
      setIncomeDraftsByUser((previous) => ({ ...previous, [userId]: savedRows }));
      setExchangeRates((previous) => mergeExchangeRatesFromIncomes(previous, savedIncomes, month));
      setEditor(null);
      setMessage(successMessage);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.saveFailed);
      return false;
    } finally {
      setSavingUserId(null);
    }
  };

  const saveEditor = async () => {
    if (!editor) {
      return;
    }

    const currentRows = incomeDraftsByUser[editor.userId] ?? [];
    const nextRows =
      editor.index === null
        ? [...currentRows, editor.draft]
        : currentRows.map((row, index) => (index === editor.index ? editor.draft : row));
    await persistUserRows(
      editor.userId,
      nextRows,
      editor.index === null ? copy.incomeSaved : copy.incomeUpdated,
    );
  };

  const confirmRemoveIncome = async () => {
    if (!pendingIncomeRemoval) {
      return;
    }

    const rows = incomeDraftsByUser[pendingIncomeRemoval.userId] ?? [];
    const nextRows = rows.filter((_, index) => index !== pendingIncomeRemoval.index);
    const removed = await persistUserRows(
      pendingIncomeRemoval.userId,
      nextRows,
      copy.incomeRemoved,
    );
    if (removed) {
      setPendingIncomeRemoval(null);
    }
  };

  const copyFromPreviousMonth = async () => {
    if (Object.values(incomeDraftsByUser).some((rows) => rows.length > 0)) {
      const shouldOverwrite = window.confirm(
        copy.overwriteConfirm(formatMonth(previousMonth, locale)),
      );
      if (!shouldOverwrite) {
        return;
      }
    }

    try {
      setCopyingPrevious(true);
      setError(null);
      setMessage(null);
      setEditor(null);
      const previousIncomes = await getIncomes(previousMonth);
      if (previousIncomes.length === 0) {
        setMessage(copy.noPreviousIncomes(formatMonth(previousMonth, locale)));
        return;
      }

      const previousDrafts = buildIncomeDrafts(users, previousIncomes);
      const payloads = users.map((user) => {
        const payload = buildPayload(user, previousDrafts[user.id] ?? []);
        if (!payload.entries) {
          throw new Error(payload.error ?? copy.saveFailed);
        }
        return replaceIncomesForUser({ month, userId: user.id, entries: payload.entries });
      });
      const savedByUser = await Promise.all(payloads);
      const savedIncomes = savedByUser.flat();
      setIncomeDraftsByUser(buildIncomeDrafts(users, savedIncomes));
      setExchangeRates((previous) => mergeExchangeRatesFromIncomes(previous, savedIncomes, month));
      setMessage(
        copy.previousApplied(
          formatMonth(previousMonth, locale, false),
          formatMonth(month, locale, false),
        ),
      );
    } catch (copyError) {
      try {
        const currentIncomes = await getIncomes(month);
        setIncomeDraftsByUser(buildIncomeDrafts(users, currentIncomes));
      } catch {
        // Keep the last confirmed local state if reconciliation is unavailable.
      }
      setError(copyError instanceof Error ? copyError.message : copy.previousLoadFailed);
    } finally {
      setCopyingPrevious(false);
    }
  };

  return (
    <AppShell
      compact
      containerClassName="max-w-[1480px]"
      locale={locale}
      month={month}
      rightSlot={<MonthSelector locale={locale} month={month} />}
      subtitle={copy.subtitle}
      title={copy.title}
      unframed
    >
      {pendingIncomeRemoval ? (
        <ConfirmationDialog
          busy={savingUserId === pendingIncomeRemoval.userId}
          cancelLabel={shared.cancel}
          confirmLabel={copy.removeIncome}
          message={copy.removeMessage(pendingIncomeRemoval.description)}
          onCancel={() => setPendingIncomeRemoval(null)}
          onConfirm={() => void confirmRemoveIncome()}
          title={copy.confirmRemoval}
        />
      ) : null}

      <div className="space-y-4">
        {error ? (
          <div
            aria-live="assertive"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {message ? (
          <div
            aria-live="polite"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
            role="status"
          >
            {message}
          </div>
        ) : null}

        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-ink-strong">{copy.incomeByPartner}</h2>
            <p className="mt-1 text-sm text-ink-muted">{copy.incomeByPartnerHelp}</p>
          </div>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            onClick={() => void copyFromPreviousMonth()}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M4 12a8 8 0 1 0 2.3-5.7" />
              <path d="M4 4v5h5" />
            </svg>
            {copyingPrevious
              ? copy.loadingPrevious
              : copy.usePrevious(formatMonth(previousMonth, locale, false))}
          </button>
        </div>

        <section className="grid gap-5 rounded-2xl border border-brand-100 bg-white p-5 shadow-sm md:grid-cols-[minmax(0,0.8fr)_minmax(24rem,1.2fr)] md:items-center md:p-6">
          <div>
            <p className="text-sm font-semibold text-ink-muted">{copy.totalCombinedIncome}</p>
            <p className="mt-2 text-[clamp(2rem,5vw,3rem)] font-bold leading-none tracking-[-0.03em] text-ink-strong tabular-nums">
              <span className="mr-2 text-xs font-bold tracking-[0.08em] text-ink-soft">ARS</span>
              {formatArs(total, locale)}
            </p>
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-muted">
              {copy.fairSplitFor(formatMonth(month, locale, false))}
            </p>
            <div
              aria-label={partnerSummaries
                .map(
                  ({ percentage, user }) => `${user.name} ${formatPercentage(percentage, locale)}%`,
                )
                .join(', ')}
              className="mt-3 flex h-10 overflow-hidden rounded-xl bg-slate-100"
              role="img"
            >
              {partnerSummaries.map(({ percentage, tone, user, visualPercentage }) => (
                <span
                  key={user.id}
                  className={`flex min-w-0 items-center px-3 text-xs font-bold text-white ${tone.segment}`}
                  style={{ width: `${visualPercentage}%` }}
                  title={`${user.name} ${formatPercentage(percentage, locale)}%`}
                >
                  <span className="truncate">{user.name}</span>
                  <span className="ml-1">{formatPercentage(percentage, locale)}%</span>
                </span>
              ))}
            </div>
          </div>
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-2">
          {partnerSummaries.map(({ percentage, tone, user, userTotal }) => {
            const rows = incomeDraftsByUser[user.id] ?? [];
            const activeEditor = editor?.userId === user.id ? editor : null;
            const busy = savingUserId === user.id;

            return (
              <section
                key={user.id}
                aria-busy={busy}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-start justify-between gap-4 bg-slate-50/80 px-4 py-4 md:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${tone.avatar}`}
                    >
                      {getUserInitial(user.name)}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-bold text-ink-strong">{user.name}</h3>
                      <p className="text-xs text-ink-soft">
                        {copy.shareOfHousehold(formatPercentage(percentage, locale))}
                      </p>
                    </div>
                  </div>
                  <p className="pt-1 text-right text-sm font-bold text-ink-strong tabular-nums">
                    <span className="mr-1 text-xs tracking-[0.08em] text-ink-soft">ARS</span>
                    {formatArs(userTotal, locale)}
                  </p>
                </div>

                {rows.length === 0 && !activeEditor ? (
                  <p className="border-t border-slate-100 px-4 py-5 text-sm text-ink-muted md:px-5">
                    {copy.noEntries}
                  </p>
                ) : null}

                <div>
                  {rows.map((row, index) => {
                    const amountArs = parseIncomeAmountToArs(row);
                    const isNegative = Number(row.amount) < 0;
                    return (
                      <div
                        key={row.id ?? `${user.id}-${index}`}
                        className={`grid min-h-[68px] grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-3 border-t border-slate-100 px-4 py-3 md:px-5 ${
                          isNegative ? 'bg-rose-50/45' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-bold text-ink-strong">
                              {row.description}
                            </p>
                            {isNegative ? (
                              <span className="inline-flex min-h-6 items-center rounded-full bg-rose-100 px-2 text-xs font-bold text-rose-700">
                                {copy.deduction}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-ink-soft">
                            {isNegative
                              ? copy.deductionDescription
                              : row.currencyCode === 'ARS'
                                ? `${copy.monthlyIncome} · ARS`
                                : `${row.currencyCode} ${formatArs(Number(row.amount), locale)} · ${copy.fxRate} ${formatRate(row.fxRate, locale)}`}
                          </p>
                        </div>
                        <p
                          className={`text-right text-sm font-bold tabular-nums ${isNegative ? 'text-rose-700' : 'text-ink-strong'}`}
                        >
                          <span className="mr-1 text-xs tracking-[0.06em] text-ink-soft">ARS</span>
                          {formatArs(amountArs, locale)}
                        </p>
                        <button
                          aria-label={copy.editIncome(row.description)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50"
                          disabled={isBusy}
                          onClick={() => openEditIncome(user.id, index)}
                          type="button"
                        >
                          <svg
                            aria-hidden="true"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {activeEditor ? (
                  <IncomeEntryForm
                    key={`${activeEditor.userId}-${activeEditor.index ?? 'new'}`}
                    busy={busy}
                    copy={copy}
                    draft={activeEditor.draft}
                    exchangeRates={exchangeRates}
                    isEditing={activeEditor.index !== null}
                    locale={locale}
                    onCancel={() => setEditor(null)}
                    onChange={(draft) =>
                      setEditor((current) => (current ? { ...current, draft } : current))
                    }
                    onRemove={
                      activeEditor.index === null
                        ? undefined
                        : () =>
                            setPendingIncomeRemoval({
                              description:
                                activeEditor.draft.description ||
                                copy.rowFallbackLabel(activeEditor.index! + 1),
                              index: activeEditor.index!,
                              userId: user.id,
                            })
                    }
                    onSave={() => void saveEditor()}
                    shared={shared}
                    user={user}
                  />
                ) : (
                  <button
                    className="m-3 inline-flex min-h-11 w-[calc(100%-1.5rem)] items-center justify-center gap-2 rounded-xl border border-dashed border-brand-200 bg-brand-50/40 px-4 py-2 text-sm font-bold text-brand-700 hover:border-brand-400 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isBusy}
                    onClick={() => openAddIncome(user.id)}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="2.2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    {copy.addIncomeFor(user.name)}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
