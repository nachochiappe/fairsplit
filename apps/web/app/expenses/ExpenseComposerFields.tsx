'use client';

import { computeInstallmentAmounts } from '@fairsplit/shared';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Controller, useWatch } from 'react-hook-form';
import { formatMoney } from '../../lib/currency';
import type { Translation } from '../../lib/i18n';
import {
  Category,
  ExchangeRate,
  getExpenseDescriptionSuggestions,
  type AppLocale,
  User,
} from '../../lib/api';
import {
  fieldClass,
  moneyInputClass,
  pillToggleThumbClass,
  pillToggleTrackClass,
  secondaryButtonClass,
} from './expense-styles';
import {
  DEFAULT_CURRENCY_CODE,
  ExpenseForm,
  resolveInstallmentTotalAmountOnEnable,
  supportedCurrencyCodes,
  type SupportedCurrencyCode,
} from './expense-form';
import { AmountCalculator } from './AmountCalculator';

const DESCRIPTION_SUGGESTION_DEBOUNCE_MS = 200;

type ExpensesCopy = Translation['expenses'];
type CommonCopy = Translation['common'];

interface ExpenseDescriptionFieldProps {
  form: UseFormReturn<ExpenseForm>;
  inputClassName: string;
  label: string;
  labelClassName: string;
}

function ExpenseDescriptionField({
  form,
  inputClassName,
  label,
  labelClassName,
}: ExpenseDescriptionFieldProps) {
  const listboxId = useId();
  const description = useWatch({ control: form.control, name: 'description' }) ?? '';
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registration = form.register('description');
  const visibleSuggestions = suggestions.filter(
    (suggestion) =>
      suggestion.trim().toLocaleLowerCase() !== description.trim().toLocaleLowerCase(),
  );

  useEffect(() => {
    const query = description.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      getExpenseDescriptionSuggestions(query, { cache: 'no-store', signal: controller.signal })
        .then((nextSuggestions) => {
          setSuggestions(nextSuggestions);
          setIsOpen(
            nextSuggestions.some(
              (suggestion) => suggestion.trim().toLocaleLowerCase() !== query.toLocaleLowerCase(),
            ),
          );
          setActiveIndex(-1);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }
          setSuggestions([]);
          setIsOpen(false);
          setActiveIndex(-1);
        });
    }, DESCRIPTION_SUGGESTION_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [description]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const selectSuggestion = (suggestion: string) => {
    form.setValue('description', suggestion, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || visibleSuggestions.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleSuggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? visibleSuggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(visibleSuggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <label className="relative block text-sm">
      <span className={labelClassName}>{label}</span>
      <input
        className={inputClassName}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen && visibleSuggestions.length > 0}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        {...registration}
        onBlur={(event) => {
          void registration.onBlur(event);
          blurTimeoutRef.current = setTimeout(() => {
            setIsOpen(false);
            setActiveIndex(-1);
          }, 120);
        }}
        onChange={(event) => {
          void registration.onChange(event);
        }}
        onFocus={() => {
          if (visibleSuggestions.length > 0) {
            if (blurTimeoutRef.current) {
              clearTimeout(blurTimeoutRef.current);
              blurTimeoutRef.current = null;
            }
            setIsOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
      />
      {isOpen && visibleSuggestions.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {visibleSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              type="button"
              className={`block w-full px-3 py-2 text-left text-sm text-slate-800 ${
                index === activeIndex ? 'bg-blue-50 text-brand-700' : 'hover:bg-slate-50'
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                selectSuggestion(suggestion);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </label>
  );
}

/**
 * Owns every `useWatch` subscription for the composer. Keeping these inside the
 * composer subtree is the point: a keystroke in the amount field must not
 * re-render the expense tables that sit beside it.
 *
 * Only one composer variant is mounted at a time — the mobile one lives in a
 * modal, the desktop one is gated on that modal being closed — so the effects
 * below never run twice against the same form.
 */
function useComposerState(form: UseFormReturn<ExpenseForm>, exchangeRates: ExchangeRate[]) {
  const installmentEnabled = useWatch({ control: form.control, name: 'installmentEnabled' });
  const installmentCount = useWatch({ control: form.control, name: 'installmentCount' });
  const installmentEntryMode = useWatch({ control: form.control, name: 'installmentEntryMode' });
  const amount = useWatch({ control: form.control, name: 'amount' });
  const totalAmount = useWatch({ control: form.control, name: 'totalAmount' });
  const currencyCode = useWatch({ control: form.control, name: 'currencyCode' });
  const fxRate = useWatch({ control: form.control, name: 'fxRate' });
  const applyToFuture = useWatch({ control: form.control, name: 'applyToFuture' });
  const fixedEnabled = useWatch({ control: form.control, name: 'fixedEnabled' });
  const nextMonthExpense = useWatch({ control: form.control, name: 'nextMonthExpense' });

  useEffect(() => {
    if (installmentEnabled) {
      const totalAmountOnEnable = resolveInstallmentTotalAmountOnEnable({
        amount: form.getValues('amount'),
        installmentEntryMode: form.getValues('installmentEntryMode'),
        totalAmount: form.getValues('totalAmount'),
      });

      if (totalAmountOnEnable !== form.getValues('totalAmount')) {
        form.setValue('totalAmount', totalAmountOnEnable, {
          shouldDirty: true,
          shouldTouch: true,
        });
      }

      return;
    }

    form.setValue('installmentCount', 2);
    form.setValue('installmentEntryMode', 'total');
    form.setValue('totalAmount', undefined);
  }, [form, installmentEnabled]);

  // Seeded from the live form value rather than a constant so that remounting the
  // composer is not mistaken for the user changing currency.
  const previousCurrencyRef = useRef<SupportedCurrencyCode>(
    (form.getValues('currencyCode') as SupportedCurrencyCode | undefined) ?? DEFAULT_CURRENCY_CODE,
  );

  const monthlyRateForCurrency = useMemo(() => {
    return exchangeRates.find((rate) => rate.currencyCode === currencyCode)?.rateToArs;
  }, [exchangeRates, currencyCode]);

  const effectiveFxRate =
    currencyCode === 'ARS' ? 1 : Number(fxRate ?? monthlyRateForCurrency ?? 0);

  const projectedArsAmount = useMemo(() => {
    const baseAmount = installmentEntryMode === 'total' ? totalAmount : amount;
    if (baseAmount === undefined || Number.isNaN(baseAmount)) {
      return null;
    }
    if (!effectiveFxRate || Number.isNaN(effectiveFxRate)) {
      return null;
    }
    return Number(baseAmount) * effectiveFxRate;
  }, [effectiveFxRate, amount, installmentEntryMode, totalAmount]);

  const installmentPreview = useMemo(() => {
    if (!installmentEnabled || !installmentCount || !installmentEntryMode) {
      return null;
    }

    try {
      const schedule = computeInstallmentAmounts({
        count: installmentCount,
        entryMode: installmentEntryMode,
        perInstallmentAmount: installmentEntryMode === 'perInstallment' ? amount : undefined,
        totalAmount: installmentEntryMode === 'total' ? totalAmount : undefined,
      });
      const first = schedule.amounts[0] ?? '0.00';
      const last = schedule.amounts[schedule.amounts.length - 1] ?? first;
      return { first, last, total: schedule.totalAmount, count: installmentCount };
    } catch {
      return null;
    }
  }, [amount, installmentCount, installmentEnabled, installmentEntryMode, totalAmount]);

  useEffect(() => {
    const previousCurrencyCode = previousCurrencyRef.current;
    const currencyChanged = previousCurrencyCode !== currencyCode;
    previousCurrencyRef.current = currencyCode;

    if (currencyCode === 'ARS') {
      form.setValue('fxRate', 1, { shouldDirty: true });
      return;
    }

    if (monthlyRateForCurrency) {
      form.setValue('fxRate', Number(monthlyRateForCurrency), { shouldDirty: true });
      return;
    }

    if (
      currencyChanged &&
      previousCurrencyCode === 'ARS' &&
      Number(form.getValues('fxRate') ?? 0) === 1
    ) {
      form.setValue('fxRate', undefined, { shouldDirty: true });
    }
  }, [form, monthlyRateForCurrency, currencyCode]);

  return {
    installmentEnabled,
    installmentEntryMode,
    currencyCode,
    applyToFuture,
    fixedEnabled,
    nextMonthExpense,
    projectedArsAmount,
    installmentPreview,
  };
}

interface ComposerFieldsProps {
  form: UseFormReturn<ExpenseForm>;
  copy: ExpensesCopy;
  shared: CommonCopy;
  locale: AppLocale;
  categories: Category[];
  users: User[];
  exchangeRates: ExchangeRate[];
  editingExpenseId: string | null;
  onCancel: () => void;
  showCancel?: boolean;
  submitState: ExpenseComposerSubmitState;
}

export type ExpenseComposerSubmitState = 'idle' | 'saving' | 'success';

interface ControlledAmountFieldProps {
  copy: ExpensesCopy;
  form: UseFormReturn<ExpenseForm>;
  inputClassName: string;
  label: string;
  labelClassName: string;
  name: 'amount' | 'totalAmount';
}

function ControlledAmountField({
  copy,
  form,
  inputClassName,
  label,
  labelClassName,
  name,
}: ControlledAmountFieldProps) {
  const inputId = useId();

  return (
    <div className="block text-sm">
      <label className={labelClassName} htmlFor={inputId}>
        {label}
      </label>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-slate-500"
            >
              $
            </span>
            <input
              className={`${inputClassName} pr-12`}
              id={inputId}
              min="0"
              name={field.name}
              onBlur={field.onBlur}
              onChange={(event) => {
                const nextValue = event.target.value;
                field.onChange(nextValue === '' ? undefined : Number(nextValue));
              }}
              ref={field.ref}
              step="0.01"
              type="number"
              value={field.value ?? ''}
            />
            <AmountCalculator
              copy={copy.form.calculator}
              onApply={(nextValue) => {
                form.setValue(name, nextValue, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                });
              }}
              value={field.value}
            />
          </div>
        )}
      />
    </div>
  );
}

export function ExpenseComposerFields({
  form,
  copy,
  shared,
  locale,
  categories,
  users,
  exchangeRates,
  editingExpenseId,
  onCancel,
  showCancel = true,
  submitState,
}: ComposerFieldsProps) {
  const {
    installmentEnabled,
    installmentEntryMode,
    currencyCode,
    applyToFuture,
    fixedEnabled,
    nextMonthExpense,
    projectedArsAmount,
    installmentPreview,
  } = useComposerState(form, exchangeRates);
  const [showDetails, setShowDetails] = useState(Boolean(editingExpenseId));

  useEffect(() => {
    if (editingExpenseId) {
      setShowDetails(true);
    }
  }, [editingExpenseId]);

  const submitLabel = editingExpenseId ? copy.form.update : copy.form.add;
  const submitAriaLabel =
    submitState === 'saving'
      ? shared.saving
      : submitState === 'success'
        ? editingExpenseId
          ? copy.toasts.expenseUpdated
          : copy.toasts.expenseAdded
        : submitLabel;

  return (
    <fieldset className="contents" disabled={submitState !== 'idle'}>
      {installmentEnabled && installmentEntryMode === 'total' ? (
        <ControlledAmountField
          copy={copy}
          form={form}
          inputClassName={`${moneyInputClass} min-h-11 rounded-xl`}
          label={copy.form.totalAmount}
          labelClassName="mb-1 block text-xs font-medium text-slate-600"
          name="totalAmount"
        />
      ) : (
        <ControlledAmountField
          copy={copy}
          form={form}
          inputClassName={`${moneyInputClass} min-h-11 rounded-xl`}
          label={installmentEnabled ? copy.form.perInstallmentAmount : copy.form.amount}
          labelClassName="mb-1 block text-xs font-medium text-slate-600"
          name="amount"
        />
      )}
      <ExpenseDescriptionField
        form={form}
        inputClassName="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        label={copy.form.description}
        labelClassName="mb-1 block text-xs font-medium text-slate-600"
      />
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-600">{copy.form.paidBy}</span>
        <select
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          {...form.register('paidByUserId')}
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-600">{copy.form.category}</span>
        <select
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          {...form.register('categoryId')}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <button
        aria-controls="desktop-expense-details"
        aria-expanded={showDetails}
        className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-brand-700"
        onClick={() => setShowDetails((current) => !current)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={`h-4 w-4 transition-transform ${showDetails ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        {showDetails ? copy.form.fewerDetails : copy.form.moreDetails}
      </button>

      {showDetails ? (
        <div className="space-y-4" id="desktop-expense-details">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-700 transition hover:border-slate-200 hover:bg-slate-50">
            <span>{copy.form.recurringExpense}</span>
            <span className="relative inline-flex items-center">
              <input
                checked={fixedEnabled}
                className="peer sr-only"
                onChange={(event) => {
                  form.setValue('fixedEnabled', event.target.checked, {
                    shouldDirty: true,
                    shouldTouch: true,
                  });
                }}
                type="checkbox"
              />
              <span aria-hidden="true" className={pillToggleTrackClass} />
              <span aria-hidden="true" className={pillToggleThumbClass} />
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-700 transition hover:border-slate-200 hover:bg-slate-50">
            <span>{copy.form.nextMonthExpense}</span>
            <span className="relative inline-flex items-center">
              <input
                checked={nextMonthExpense}
                className="peer sr-only"
                onChange={(event) => {
                  form.setValue('nextMonthExpense', event.target.checked, {
                    shouldDirty: true,
                    shouldTouch: true,
                  });
                }}
                type="checkbox"
              />
              <span aria-hidden="true" className={pillToggleTrackClass} />
              <span aria-hidden="true" className={pillToggleThumbClass} />
            </span>
          </label>
          {editingExpenseId && fixedEnabled && !installmentEnabled ? (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-700 transition hover:border-slate-200 hover:bg-slate-50">
              <span>{copy.form.applyToFuture}</span>
              <span className="relative inline-flex items-center">
                <input
                  checked={applyToFuture}
                  className="peer sr-only"
                  onChange={(event) => {
                    form.setValue('applyToFuture', event.target.checked, {
                      shouldDirty: true,
                      shouldTouch: true,
                    });
                  }}
                  type="checkbox"
                />
                <span aria-hidden="true" className={pillToggleTrackClass} />
                <span aria-hidden="true" className={pillToggleThumbClass} />
              </span>
            </label>
          ) : null}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-700 transition hover:border-slate-200 hover:bg-slate-50">
            <span>{copy.form.installments}</span>
            <span className="relative inline-flex items-center">
              <input
                checked={installmentEnabled}
                className="peer sr-only"
                onChange={(event) => {
                  form.setValue('installmentEnabled', event.target.checked, {
                    shouldDirty: true,
                    shouldTouch: true,
                  });
                }}
                type="checkbox"
              />
              <span aria-hidden="true" className={pillToggleTrackClass} />
              <span aria-hidden="true" className={pillToggleThumbClass} />
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">{copy.form.date}</span>
            <input
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 [color-scheme:light] [&::-webkit-date-and-time-value]:text-left"
              lang="en"
              type="date"
              {...form.register('date')}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {copy.form.currency}
              </span>
              <select
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                {...form.register('currencyCode')}
              >
                {supportedCurrencyCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {copy.form.fxToArs}
              </span>
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-slate-500"
                >
                  $
                </span>
                <input
                  className={`${moneyInputClass} min-h-11 rounded-xl disabled:bg-slate-100`}
                  disabled={currencyCode === 'ARS'}
                  min="0"
                  step="0.000001"
                  type="number"
                  {...form.register('fxRate')}
                />
              </div>
            </label>
          </div>

          {installmentEnabled ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  {copy.form.installmentCount}
                </span>
                <input
                  className={`${fieldClass} min-h-11 rounded-xl`}
                  min="2"
                  type="number"
                  {...form.register('installmentCount')}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  {copy.form.entryMode}
                </span>
                <select
                  className={`${fieldClass} min-h-11 rounded-xl`}
                  {...form.register('installmentEntryMode')}
                >
                  <option value="perInstallment">{copy.form.perInstallmentOption}</option>
                  <option value="total">{copy.form.totalAmountOption}</option>
                </select>
              </label>
            </div>
          ) : null}

          {installmentPreview ? (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {copy.form.installmentPreview(
                installmentPreview.count,
                formatMoney(installmentPreview.first, locale),
                formatMoney(installmentPreview.last, locale),
                formatMoney(installmentPreview.total, locale),
              )}
            </div>
          ) : null}

          {currencyCode !== 'ARS' && projectedArsAmount !== null ? (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {copy.form.estimatedArs(formatMoney(projectedArsAmount.toFixed(2), locale))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          aria-label={submitAriaLabel}
          className="expense-submit-button relative inline-grid min-h-11 w-full place-items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          data-state={submitState}
          disabled={submitState !== 'idle'}
          type="submit"
        >
          <span aria-hidden="true" className="expense-submit-button__surface" />
          <span aria-hidden="true" className="expense-submit-button__saving-surface" />
          <span aria-hidden="true" className="expense-submit-button__success-surface" />
          <span className="expense-submit-button__label">
            <span aria-hidden="true" className="text-base leading-none">
              +
            </span>
            {submitLabel}
          </span>
          <span aria-hidden="true" className="expense-submit-button__status">
            <span className="t-icon-swap" data-state={submitState === 'success' ? 'b' : 'a'}>
              <svg
                className="t-icon h-5 w-5 animate-spin"
                data-icon="a"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  cx="12"
                  cy="12"
                  opacity="0.35"
                  r="8.5"
                  stroke="currentColor"
                  strokeWidth="2.5"
                />
                <path
                  d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2.5"
                />
              </svg>
              <svg
                className="t-icon h-5 w-5"
                data-icon="b"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.8"
                viewBox="0 0 24 24"
              >
                <path className="expense-submit-button__check-path" d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </span>
          </span>
        </button>
        {editingExpenseId && showCancel ? (
          <button
            className={secondaryButtonClass}
            disabled={submitState !== 'idle'}
            type="button"
            onClick={onCancel}
          >
            {shared.cancel}
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}
