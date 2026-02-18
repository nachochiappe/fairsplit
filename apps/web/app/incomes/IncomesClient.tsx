'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { MonthSelector } from '../../components/MonthSelector';
import {
  getExchangeRates,
  getIncomes,
  replaceIncomesForUser,
  type ExchangeRate,
  type Income,
  type User,
} from '../../lib/api';
import { formatMoney } from '../../lib/currency';

type IncomeDraft = {
  id?: string;
  description: string;
  amount: string;
  currencyCode: SupportedCurrencyCode;
  fxRate: string;
};

const supportedCurrencyCodes = ['ARS', 'USD', 'EUR'] as const;
type SupportedCurrencyCode = (typeof supportedCurrencyCodes)[number];
const DEFAULT_CURRENCY_CODE: SupportedCurrencyCode = 'ARS';
const surfaceClass = 'rounded-3xl border border-slate-200 bg-white/90 shadow-sm';
const fieldClass =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-base placeholder:text-slate-400 focus-visible:border-slate-300 focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/20 focus-visible:ring-offset-1';
const subtleButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-6 py-3 text-base font-bold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

function toSupportedCurrencyCode(value: string): SupportedCurrencyCode {
  const normalizedValue = value.trim().toUpperCase();
  return supportedCurrencyCodes.includes(normalizedValue as SupportedCurrencyCode)
    ? (normalizedValue as SupportedCurrencyCode)
    : DEFAULT_CURRENCY_CODE;
}

function getPreviousMonth(month: string): string {
  const [yearPart, monthPart] = month.split('-');
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const date = new Date(Date.UTC(year, monthIndex, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${nextMonth}`;
}

function getUserInitial(name: string): string {
  const trimmedName = name.trim();
  return trimmedName.length > 0 ? trimmedName[0]!.toUpperCase() : '?';
}

function buildIncomeDrafts(users: User[], incomes: Income[]): Record<string, IncomeDraft[]> {
  const nextDrafts: Record<string, IncomeDraft[]> = {};
  for (const user of users) {
    nextDrafts[user.id] = [];
  }

  for (const income of incomes) {
    if (!nextDrafts[income.userId]) {
      nextDrafts[income.userId] = [];
    }

    const currencyCode = toSupportedCurrencyCode(income.currencyCode);
    nextDrafts[income.userId].push({
      id: income.id,
      description: income.description,
      amount: Number(income.amountOriginal).toFixed(2),
      currencyCode,
      fxRate: currencyCode === 'ARS' ? '1' : income.fxRateUsed,
    });
  }

  return nextDrafts;
}

function areIncomeDraftMapsEqual(
  left: Record<string, IncomeDraft[]>,
  right: Record<string, IncomeDraft[]>,
): boolean {
  const userIds = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const userId of userIds) {
    const leftRows = left[userId] ?? [];
    const rightRows = right[userId] ?? [];

    if (leftRows.length !== rightRows.length) {
      return false;
    }

    for (let index = 0; index < leftRows.length; index += 1) {
      const leftRow = leftRows[index];
      const rightRow = rightRows[index];
      if (
        leftRow?.description !== rightRow?.description ||
        leftRow?.amount !== rightRow?.amount ||
        leftRow?.currencyCode !== rightRow?.currencyCode ||
        leftRow?.fxRate !== rightRow?.fxRate
      ) {
        return false;
      }
    }
  }

  return true;
}

interface IncomesClientProps {
  month: string;
  initialUsers: User[];
  initialIncomes: Income[];
  initialExchangeRates: ExchangeRate[];
}

export function IncomesClient({ month, initialUsers, initialIncomes, initialExchangeRates }: IncomesClientProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>(initialExchangeRates);
  const [incomeDraftsByUser, setIncomeDraftsByUser] = useState<Record<string, IncomeDraft[]>>(
    () => buildIncomeDrafts(initialUsers, initialIncomes),
  );
  const [baselineIncomeDraftsByUser, setBaselineIncomeDraftsByUser] = useState<Record<string, IncomeDraft[]>>(
    () => buildIncomeDrafts(initialUsers, initialIncomes),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyingPrevious, setCopyingPrevious] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousMonth = useMemo(() => getPreviousMonth(month), [month]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setMessage(null);

      const [incomesResponse, rates] = await Promise.all([getIncomes(month), getExchangeRates(month)]);
      const nextDrafts = buildIncomeDrafts(users, incomesResponse);
      setIncomeDraftsByUser(nextDrafts);
      setBaselineIncomeDraftsByUser(nextDrafts);
      setExchangeRates(rates);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load incomes');
    } finally {
      setLoading(false);
    }
  }, [month, users]);

  useEffect(() => {
    const nextDrafts = buildIncomeDrafts(initialUsers, initialIncomes);
    setUsers(initialUsers);
    setIncomeDraftsByUser(nextDrafts);
    setBaselineIncomeDraftsByUser(nextDrafts);
    setExchangeRates(initialExchangeRates);
    setLoading(false);
    setError(null);
  }, [initialExchangeRates, initialUsers, initialIncomes]);

  const hasUnsavedChanges = useMemo(
    () => !areIncomeDraftMapsEqual(incomeDraftsByUser, baselineIncomeDraftsByUser),
    [baselineIncomeDraftsByUser, incomeDraftsByUser],
  );

  const discardChanges = () => {
    setIncomeDraftsByUser(baselineIncomeDraftsByUser);
    setError(null);
    setMessage(null);
  };

  const updateDraftDescription = (userId: string, index: number, nextDescription: string) => {
    setIncomeDraftsByUser((previous) => {
      const nextRows = [...(previous[userId] ?? [])];
      nextRows[index] = { ...nextRows[index], description: nextDescription };
      return { ...previous, [userId]: nextRows };
    });
  };

  const updateDraftAmount = (userId: string, index: number, nextAmount: string) => {
    setIncomeDraftsByUser((previous) => {
      const nextRows = [...(previous[userId] ?? [])];
      nextRows[index] = { ...nextRows[index], amount: nextAmount };
      return { ...previous, [userId]: nextRows };
    });
  };

  const updateDraftCurrencyCode = (userId: string, index: number, nextCurrencyCode: SupportedCurrencyCode) => {
    setIncomeDraftsByUser((previous) => {
      const nextRows = [...(previous[userId] ?? [])];
      const monthRate = exchangeRates.find((rate) => rate.currencyCode === nextCurrencyCode)?.rateToArs;
      const nextFxRate = nextCurrencyCode === 'ARS' ? '1' : monthRate ?? '';
      nextRows[index] = { ...nextRows[index], currencyCode: nextCurrencyCode, fxRate: nextFxRate };
      return { ...previous, [userId]: nextRows };
    });
  };

  const updateDraftFxRate = (userId: string, index: number, nextFxRate: string) => {
    setIncomeDraftsByUser((previous) => {
      const nextRows = [...(previous[userId] ?? [])];
      nextRows[index] = { ...nextRows[index], fxRate: nextFxRate };
      return { ...previous, [userId]: nextRows };
    });
  };

  const addIncomeDraft = (userId: string) => {
    setIncomeDraftsByUser((previous) => ({
      ...previous,
      [userId]: [...(previous[userId] ?? []), { description: '', amount: '', currencyCode: 'ARS', fxRate: '1' }],
    }));
  };

  const removeIncomeDraft = (userId: string, index: number) => {
    setIncomeDraftsByUser((previous) => {
      const nextRows = [...(previous[userId] ?? [])];
      nextRows.splice(index, 1);
      return { ...previous, [userId]: nextRows };
    });
  };

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

      const currencyCode = draft.currencyCode.trim().toUpperCase();
      const monthRate = monthRateByCurrency.get(currencyCode);
      const fallbackFxRate = draft.fxRate || (monthRate !== undefined ? String(monthRate) : '');
      const fxRate = currencyCode === 'ARS' ? 1 : Number(fallbackFxRate || NaN);
      if (!Number.isFinite(fxRate)) {
        return 0;
      }

      return amount * fxRate;
    },
    [monthRateByCurrency],
  );

  const total = useMemo(
    () => Object.values(incomeDraftsByUser).flat().reduce((sum, row) => sum + parseIncomeAmountToArs(row), 0),
    [incomeDraftsByUser, parseIncomeAmountToArs],
  );

  const totalByUser = useMemo(() => {
    const totals: Record<string, number> = {};

    for (const user of users) {
      totals[user.id] = (incomeDraftsByUser[user.id] ?? []).reduce((sum, row) => sum + parseIncomeAmountToArs(row), 0);
    }

    return totals;
  }, [incomeDraftsByUser, parseIncomeAmountToArs, users]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError(null);
    setMessage(null);

    const payloadByUser: Record<
      string,
      Array<{ description: string; amount: number; currencyCode: string; fxRate?: number }>
    > = {};

    for (const user of users) {
      const entries = incomeDraftsByUser[user.id] ?? [];
      const entriesPayload: Array<{ description: string; amount: number; currencyCode: string; fxRate?: number }> = [];

      for (const entry of entries) {
        const description = entry.description.trim();

        if (description === '' && entry.amount.trim() === '') {
          continue;
        }

        if (description === '') {
          setError(`Income description is required for ${user.name}.`);
          return;
        }

        if (entry.amount.trim() === '') {
          setError(`Income amount is required for ${user.name}.`);
          return;
        }

        const currencyCode = toSupportedCurrencyCode(entry.currencyCode);

        const amount = Number(entry.amount);
        if (!Number.isFinite(amount)) {
          setError(`Invalid income amount for ${user.name}.`);
          return;
        }

        const explicitFxRate = entry.fxRate.trim() === '' ? undefined : Number(entry.fxRate);
        if (currencyCode !== 'ARS' && explicitFxRate !== undefined && (!Number.isFinite(explicitFxRate) || explicitFxRate <= 0)) {
          setError(`FX rate must be greater than 0 for ${user.name}.`);
          return;
        }

        entriesPayload.push({ description, amount, currencyCode, fxRate: explicitFxRate });
      }

      payloadByUser[user.id] = entriesPayload;
    }

    try {
      setSaving(true);
      await Promise.all(
        users.map((user) =>
          replaceIncomesForUser({
            month,
            userId: user.id,
            entries: payloadByUser[user.id] ?? [],
          }),
        ),
      );
      setMessage('Incomes saved');
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save incomes');
    } finally {
      setSaving(false);
    }
  };

  const copyFromPreviousMonth = useCallback(async () => {
    if (Object.values(incomeDraftsByUser).some((rows) => rows.length > 0)) {
      const shouldOverwrite = window.confirm(
        `This will replace the current draft with incomes from ${previousMonth}. Continue?`,
      );
      if (!shouldOverwrite) {
        return;
      }
    }

    try {
      setCopyingPrevious(true);
      setError(null);
      setMessage(null);
      const previousIncomes = await getIncomes(previousMonth);

      if (previousIncomes.length === 0) {
        setMessage(`No incomes found for ${previousMonth}.`);
        return;
      }

      setIncomeDraftsByUser(buildIncomeDrafts(users, previousIncomes));
      setMessage(`Loaded incomes from ${previousMonth}. Click "Save incomes" to apply them to ${month}.`);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Failed to load previous month incomes');
    } finally {
      setCopyingPrevious(false);
    }
  }, [incomeDraftsByUser, month, previousMonth, users]);

  return (
    <AppShell
      month={month}
      title="Monthly Incomes"
      subtitle="Add one or more income entries per partner (foreign currency supported, converted to ARS)"
      rightSlot={<MonthSelector month={month} />}
    >
      <form className="space-y-6" onSubmit={onSubmit}>
        {loading ? (
          <p aria-live="polite" className="text-sm text-slate-600">
            Loading...
          </p>
        ) : null}
        {error ? (
          <div aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {message ? (
          <div aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={copyFromPreviousMonth}
            disabled={loading || saving || copyingPrevious}
            className={subtleButtonClass}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4">
              <path
                d="M4.17 10a5.83 5.83 0 1 0 1.71-4.12"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
              <path d="M4.17 3.33v2.55h2.55" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
            {copyingPrevious ? 'Loading previous month...' : `Use incomes from ${previousMonth}`}
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
          <div className={`${surfaceClass} p-6 md:p-8`}>
            <p className="text-sm font-semibold uppercase tracking-[0.09em] text-slate-500 md:text-base">
              Total combined income (ARS)
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="text-4xl font-bold tracking-tight text-brand-600">{formatMoney(total)}</p>
            </div>
          </div>

          <aside className="rounded-3xl bg-brand-600 p-6 text-brand-50 shadow-md shadow-brand-700/25 md:p-8">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-brand-600">
                i
              </span>
              Exchange Rates
            </div>
            <p className="text-sm leading-relaxed text-brand-100">
              Existing month-start FX defaults are reused automatically. Enter FX once to save for this month.
            </p>
          </aside>
        </div>

        <div className="space-y-4">
          {users.map((user) => (
            <section key={user.id} className={`${surfaceClass} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-4 md:px-6 md:py-5">
                <div className="flex min-w-0 items-center gap-4">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-full bg-slate-200 text-base font-bold text-slate-600"
                  >
                    {getUserInitial(user.name)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-bold leading-tight text-slate-800">{user.name}</h3>
                    <p className="text-xs text-slate-500">
                      Total (ARS): <span className="font-semibold text-slate-800">{formatMoney(totalByUser[user.id] ?? 0)}</span>
                    </p>
                  </div>
                </div>

                <button type="button" onClick={() => addIncomeDraft(user.id)} className={subtleButtonClass}>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4">
                    <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                  </svg>
                  Add income
                </button>
              </div>

              <div className="hidden grid-cols-[1.8fr_1.9fr_0.7fr_0.7fr_auto] border-b border-slate-200 px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 md:grid">
                <span>Description</span>
                <span>Amount</span>
                <span>Currency</span>
                <span>FX rate</span>
                <span className="sr-only">Actions</span>
              </div>

              {(incomeDraftsByUser[user.id] ?? []).length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500 md:px-6">No income entries yet.</p>
              ) : null}

              <div>
                {(incomeDraftsByUser[user.id] ?? []).map((row, index) => {
                  const amountValue = Number(row.amount);
                  const isNegativeIncome = Number.isFinite(amountValue) && amountValue < 0;
                  const amountToneClass = isNegativeIncome ? 'text-red-600' : 'text-slate-800';
                  const descriptionToneClass = isNegativeIncome ? 'text-red-600' : 'text-slate-700';
                  return (
                    <div
                      key={row.id ?? `${user.id}-${index}`}
                      className="grid grid-cols-1 gap-1 border-b border-slate-100 px-3 py-2 last:border-b-0 md:grid-cols-[1.8fr_1.9fr_0.7fr_0.7fr_auto] md:gap-2 md:px-6 md:py-2"
                    >
                      <input
                        type="text"
                        name={`income-description-${user.id}-${index}`}
                        aria-label={`${user.name} income description ${index + 1}`}
                        autoComplete="off"
                        value={row.description}
                        onChange={(event) => updateDraftDescription(user.id, index, event.target.value)}
                        className={`${fieldClass} ${descriptionToneClass}`}
                        placeholder="Description"
                      />

                      <div className="relative w-full">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-base text-slate-400">$</span>
                        <input
                          type="text"
                          name={`income-amount-${user.id}-${index}`}
                          aria-label={`${user.name} income amount ${index + 1}`}
                          autoComplete="off"
                          inputMode="decimal"
                          value={row.amount}
                          onChange={(event) => updateDraftAmount(user.id, index, event.target.value)}
                          className={`${fieldClass} ${amountToneClass} pl-6`}
                          placeholder="0.00"
                        />
                      </div>

                      <select
                        name={`income-currency-${user.id}-${index}`}
                        aria-label={`${user.name} income currency ${index + 1}`}
                        value={row.currencyCode}
                        onChange={(event) =>
                          updateDraftCurrencyCode(user.id, index, event.target.value as SupportedCurrencyCode)
                        }
                        className={fieldClass}
                      >
                        {supportedCurrencyCodes.map((currencyCode) => (
                          <option key={currencyCode} value={currencyCode}>
                            {currencyCode}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        name={`income-fx-${user.id}-${index}`}
                        aria-label={`${user.name} income fx rate ${index + 1}`}
                        autoComplete="off"
                        inputMode="decimal"
                        value={row.currencyCode === 'ARS' ? '1' : row.fxRate}
                        onChange={(event) => updateDraftFxRate(user.id, index, event.target.value)}
                        disabled={row.currencyCode === 'ARS'}
                        className={`${fieldClass} ${row.currencyCode === 'ARS' ? 'bg-slate-100 text-slate-500' : ''}`}
                        placeholder="FX to ARS"
                      />

                      <div className="flex items-center justify-end md:justify-center">
                        <button
                          type="button"
                          onClick={() => removeIncomeDraft(user.id, index)}
                          className="rounded-lg px-2 py-1.5 text-sm font-medium text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className={`${surfaceClass} flex flex-col items-start justify-between gap-3 px-4 py-4 md:flex-row md:items-center md:px-5`}>
          {hasUnsavedChanges ? (
            <button
              type="button"
              onClick={discardChanges}
              disabled={saving}
              className={subtleButtonClass}
            >
              Discard changes
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <button
            type="submit"
            disabled={saving}
            className={primaryButtonClass}
          >
            {saving ? 'Saving...' : 'Save Incomes'}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
