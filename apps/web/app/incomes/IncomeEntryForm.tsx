'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AppLocale, ExchangeRate, User } from '../../lib/api';
import { formatMoney } from '../../lib/currency';
import { localeTags, type Translation } from '../../lib/i18n';

export const supportedIncomeCurrencyCodes = ['ARS', 'USD', 'EUR'] as const;
export type IncomeCurrencyCode = (typeof supportedIncomeCurrencyCodes)[number];

export interface IncomeDraft {
  id?: string;
  description: string;
  amount: string;
  currencyCode: IncomeCurrencyCode;
  fxRate: string;
}

interface IncomeEntryFormProps {
  busy: boolean;
  copy: Translation['incomes'];
  draft: IncomeDraft;
  exchangeRates: ExchangeRate[];
  isEditing: boolean;
  locale: AppLocale;
  onCancel: () => void;
  onChange: (nextDraft: IncomeDraft) => void;
  onRemove?: () => void;
  onSave: () => void;
  shared: Translation['common'];
  user: User;
}

const fieldClass =
  'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-ink-strong shadow-sm transition-colors placeholder:text-ink-soft focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/20 focus-visible:ring-offset-1';
const fieldLabelClass = 'mb-1.5 block text-xs font-semibold text-slate-600';

function formatRate(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(localeTags[locale], {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

export function IncomeEntryForm({
  busy,
  copy,
  draft,
  exchangeRates,
  isEditing,
  locale,
  onCancel,
  onChange,
  onRemove,
  onSave,
  shared,
  user,
}: IncomeEntryFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(draft.currencyCode !== 'ARS');
  const numericAmount = Number(draft.amount);
  const isNegative = Number.isFinite(numericAmount) && numericAmount < 0;
  const monthRate = exchangeRates.find(
    (rate) => rate.currencyCode === draft.currencyCode,
  )?.rateToArs;
  const effectiveRate = draft.currencyCode === 'ARS' ? 1 : Number(draft.fxRate || monthRate || NaN);
  const projectedArsAmount = useMemo(() => {
    if (!Number.isFinite(numericAmount) || !Number.isFinite(effectiveRate)) {
      return null;
    }
    return numericAmount * effectiveRate;
  }, [effectiveRate, numericAmount]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const form = formRef.current;
      if (!form) return;

      const rect = form.getBoundingClientRect();
      const bottomClearance = window.matchMedia('(max-width: 767px)').matches ? 104 : 24;
      const visibleFormHeight = Math.min(rect.height, 320);

      if (rect.top < 16 || rect.top + visibleFormHeight > window.innerHeight - bottomClearance) {
        form.scrollIntoView({ block: 'center' });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const updateCurrency = (currencyCode: IncomeCurrencyCode) => {
    const savedRate = exchangeRates.find((rate) => rate.currencyCode === currencyCode)?.rateToArs;
    onChange({
      ...draft,
      currencyCode,
      fxRate: currencyCode === 'ARS' ? '1' : (savedRate ?? ''),
    });
    if (currencyCode !== 'ARS') {
      setDetailsOpen(true);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave();
  };

  return (
    <form
      aria-label={isEditing ? copy.editIncome(draft.description) : copy.newIncomeFor(user.name)}
      className="space-y-4 border-t border-brand-100 bg-brand-50/45 p-4 md:p-5"
      onSubmit={submit}
      ref={formRef}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-base font-bold text-ink-strong">
          {isEditing ? copy.editIncome(draft.description) : copy.newIncomeFor(user.name)}
        </h4>
        <button
          aria-label={shared.cancel}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.2"
            viewBox="0 0 24 24"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={fieldLabelClass}>{copy.description}</span>
          <input
            autoComplete="off"
            autoFocus
            className={fieldClass}
            disabled={busy}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            placeholder={copy.incomeDescriptionPlaceholder}
            type="text"
            value={draft.description}
          />
        </label>

        <label>
          <span className={fieldLabelClass}>{copy.amount}</span>
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-ink-soft"
            >
              $
            </span>
            <input
              aria-describedby={`income-amount-help-${user.id}`}
              autoComplete="off"
              className={`${fieldClass} pl-8 text-right tabular-nums ${isNegative ? 'text-rose-700' : ''}`}
              disabled={busy}
              inputMode="decimal"
              onChange={(event) => onChange({ ...draft, amount: event.target.value })}
              placeholder="0.00"
              type="text"
              value={draft.amount}
            />
          </div>
          <span
            className="mt-1.5 block text-xs leading-relaxed text-ink-soft"
            id={`income-amount-help-${user.id}`}
          >
            {copy.negativeAmountHelp}
          </span>
        </label>
      </div>

      {isNegative ? (
        <div
          className="flex items-start gap-3 rounded-xl bg-rose-50 px-3.5 py-3 text-rose-800"
          role="status"
        >
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-100">
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.2"
              viewBox="0 0 24 24"
            >
              <path d="M5 12h14" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-bold">{copy.deduction}</p>
            <p className="mt-0.5 text-xs leading-relaxed">
              {copy.deductionPreview(user.name, formatMoney(Math.abs(numericAmount), locale))}
            </p>
          </div>
        </div>
      ) : null}

      <button
        aria-expanded={detailsOpen}
        className="flex min-h-11 w-full items-center justify-between rounded-xl px-1 text-sm font-bold text-brand-700 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        onClick={() => setDetailsOpen((current) => !current)}
        type="button"
      >
        {detailsOpen ? copy.fewerDetails : copy.moreDetails}
        <svg
          aria-hidden="true"
          className={`h-4 w-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.2"
          viewBox="0 0 24 24"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {detailsOpen ? (
        <div className="grid gap-4 rounded-xl border border-brand-100 bg-white p-4 sm:grid-cols-2">
          <label>
            <span className={fieldLabelClass}>{copy.currency}</span>
            <select
              className={fieldClass}
              disabled={busy}
              onChange={(event) => updateCurrency(event.target.value as IncomeCurrencyCode)}
              value={draft.currencyCode}
            >
              {supportedIncomeCurrencyCodes.map((currencyCode) => (
                <option key={currencyCode} value={currencyCode}>
                  {currencyCode}
                </option>
              ))}
            </select>
          </label>

          {draft.currencyCode === 'ARS' ? (
            <p className="flex min-h-11 items-center self-end rounded-xl bg-slate-50 px-3 text-xs leading-relaxed text-ink-muted">
              {copy.noExchangeRateNeeded}
            </p>
          ) : (
            <label>
              <span className={fieldLabelClass}>{copy.fxRate}</span>
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-ink-soft"
                >
                  $
                </span>
                <input
                  className={`${fieldClass} pl-8 text-right tabular-nums`}
                  disabled={busy}
                  inputMode="decimal"
                  onChange={(event) => onChange({ ...draft, fxRate: event.target.value })}
                  placeholder={copy.fxRate}
                  type="text"
                  value={draft.fxRate}
                />
              </div>
              {Number.isFinite(effectiveRate) ? (
                <span className="mt-1.5 block text-xs text-ink-soft">
                  {copy.exchangeRateHelp(draft.currencyCode, formatRate(effectiveRate, locale))}
                </span>
              ) : null}
            </label>
          )}

          {draft.currencyCode !== 'ARS' && projectedArsAmount !== null ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-ink-muted sm:col-span-2">
              {copy.estimatedArs(formatMoney(projectedArsAmount, locale))}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 border-t border-brand-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        {isEditing && onRemove ? (
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:opacity-60"
            disabled={busy}
            onClick={onRemove}
            type="button"
          >
            {copy.removeIncome}
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
        <div className="flex gap-2 sm:justify-end">
          <button
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60 sm:flex-none"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {shared.cancel}
          </button>
          <button
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
            disabled={busy}
            type="submit"
          >
            {busy ? shared.saving : isEditing ? copy.updateIncome : copy.saveIncome}
          </button>
        </div>
      </div>
    </form>
  );
}
