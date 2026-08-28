'use client';

import { useMemo, useState } from 'react';
import {
  type AppLocale,
  type HouseholdSplitPolicy,
  updateHouseholdSplitPolicy,
} from '../../lib/api';
import { localeTags, t } from '../../lib/i18n';

interface SplitPolicyCardProps {
  initialPolicy: HouseholdSplitPolicy;
  locale: AppLocale;
}

type ShareDraft = Record<string, string>;

function toShareDraft(policy: HouseholdSplitPolicy): ShareDraft {
  return Object.fromEntries(policy.shares.map((share) => [share.userId, share.percentage]));
}

function normalizedPercentage(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value;
}

export function SplitPolicyCard({ initialPolicy, locale }: SplitPolicyCardProps) {
  const [savedPolicy, setSavedPolicy] = useState(initialPolicy);
  const [method, setMethod] = useState<HouseholdSplitPolicy['method']>(initialPolicy.method);
  const [shares, setShares] = useState<ShareDraft>(() => toShareDraft(initialPolicy));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const copy = t(locale).settings.splitPolicy;

  const total = useMemo(
    () =>
      savedPolicy.shares.reduce((sum, share) => {
        const value = Number(shares[share.userId]);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0),
    [savedPolicy.shares, shares],
  );
  const sharesAreValid = savedPolicy.shares.every((share) => {
    const value = Number(shares[share.userId]);
    return shares[share.userId] !== '' && Number.isFinite(value) && value >= 0 && value <= 100;
  });
  const customSplitIsValid = sharesAreValid && Math.abs(total - 100) < 0.001;
  const savedShares = toShareDraft(savedPolicy);
  const isDirty =
    method !== savedPolicy.method ||
    savedPolicy.shares.some(
      (share) =>
        normalizedPercentage(shares[share.userId] ?? '') !==
        normalizedPercentage(savedShares[share.userId] ?? ''),
    );

  const updateShare = (userId: string, nextValue: string) => {
    setSuccess(null);
    setShares((current) => {
      const next = { ...current, [userId]: nextValue };
      if (savedPolicy.shares.length !== 2 || nextValue === '') {
        return next;
      }

      const parsed = Number(nextValue);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return next;
      }
      const partner = savedPolicy.shares.find((share) => share.userId !== userId);
      if (partner) {
        next[partner.userId] = (100 - parsed).toFixed(2);
      }
      return next;
    });
  };

  const onSave = async () => {
    if (method === 'custom' && !customSplitIsValid) {
      setError(copy.totalRequired);
      setSuccess(null);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const updated = await updateHouseholdSplitPolicy({
        method,
        shares: savedPolicy.shares.map((share) => ({
          userId: share.userId,
          percentage: Number(shares[share.userId]),
        })),
      });
      setSavedPolicy(updated);
      setMethod(updated.method);
      setShares(toShareDraft(updated));
      setSuccess(copy.saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const firstShare = savedPolicy.shares[0];
  const secondShare = savedPolicy.shares[1];

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-stroke/80 bg-surface shadow-sm">
      <div className="grid lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.35fr)]">
        <fieldset className="min-w-0 bg-surface-muted/60 lg:border-r lg:border-stroke">
          <legend className="sr-only">{copy.methodLegend}</legend>
          <div className="p-5 sm:p-6">
            <p aria-hidden="true" className="text-sm font-semibold text-ink-strong">
              {copy.methodLegend}
            </p>
            <div className="mt-3 space-y-3">
              {(['income', 'custom'] as const).map((option) => {
                const selected = method === option;
                return (
                  <label
                    className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                      selected
                        ? 'border-brand-300 bg-brand-50'
                        : 'border-stroke bg-white hover:border-slate-300 hover:bg-surface-muted'
                    }`}
                    key={option}
                  >
                    <input
                      checked={selected}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      name="split-method"
                      onChange={() => {
                        setMethod(option);
                        setError(null);
                        setSuccess(null);
                      }}
                      type="radio"
                      value={option}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ink-strong">
                        {option === 'income' ? copy.incomeMethod : copy.customMethod}
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-ink-muted">
                        {option === 'income' ? copy.incomeDescription : copy.customDescription}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </fieldset>

        <div className="p-5 sm:p-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
            <div className="flex items-start gap-3">
              <svg
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.3 3.6 2.4 17.3A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.7L13.7 3.6a2 2 0 0 0-3.4 0Z" />
              </svg>
              <div>
                <h3 className="text-sm font-semibold">{copy.allMonthsTitle}</h3>
                <p className="mt-1 text-sm leading-relaxed text-amber-900">
                  {copy.allMonthsDescription}
                </p>
              </div>
            </div>
          </div>

          {method === 'custom' ? (
            <div className="mt-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-ink-strong">{copy.customHeading}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{copy.customHelp}</p>
                </div>
                <p
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    customSplitIsValid ? 'text-emerald-700' : 'text-amber-800'
                  }`}
                >
                  {copy.totalLabel}:{' '}
                  {new Intl.NumberFormat(localeTags[locale], {
                    maximumFractionDigits: 2,
                  }).format(total)}
                  %
                </p>
              </div>

              {savedPolicy.shares.length === 2 && firstShare && secondShare ? (
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-4 text-sm font-semibold text-ink-strong">
                    <span className="truncate">{firstShare.userName}</span>
                    <span className="truncate text-right">{secondShare.userName}</span>
                  </div>
                  <input
                    aria-describedby={!customSplitIsValid ? 'split-percentage-error' : undefined}
                    aria-invalid={!customSplitIsValid}
                    aria-label={copy.sliderLabel(firstShare.userName, secondShare.userName)}
                    aria-valuetext={`${firstShare.userName} ${shares[firstShare.userId]}%, ${secondShare.userName} ${shares[secondShare.userId]}%`}
                    className="mt-2 h-11 w-full cursor-pointer accent-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    max="100"
                    min="0"
                    onChange={(event) => updateShare(firstShare.userId, event.target.value)}
                    step="1"
                    type="range"
                    value={Number(shares[firstShare.userId]) || 0}
                  />
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {savedPolicy.shares.map((share) => (
                  <label
                    className="block"
                    htmlFor={`split-share-${share.userId}`}
                    key={share.userId}
                  >
                    <span className="text-sm font-medium text-ink-base">{share.userName}</span>
                    <span className="relative mt-2 block">
                      <input
                        aria-describedby={!customSplitIsValid ? 'split-percentage-error' : undefined}
                        aria-invalid={!customSplitIsValid}
                        className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 pr-10 text-base font-semibold tabular-nums text-ink-strong shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                        id={`split-share-${share.userId}`}
                        inputMode="decimal"
                        max="100"
                        min="0"
                        onChange={(event) => updateShare(share.userId, event.target.value)}
                        step="0.01"
                        type="number"
                        value={shares[share.userId] ?? ''}
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-muted"
                      >
                        %
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {!customSplitIsValid ? (
                <p
                  aria-live="polite"
                  className="mt-3 text-sm font-medium text-amber-800"
                  id="split-percentage-error"
                >
                  {copy.totalRequired}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-6 border-t border-stroke pt-5">
              <h3 className="text-lg font-semibold text-ink-strong">{copy.incomeHeading}</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
                {copy.incomeHelp}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-stroke bg-surface-muted/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        {error ? (
          <p aria-live="assertive" className="text-sm font-medium text-red-700 sm:mr-auto">
            {error}
          </p>
        ) : null}
        {success ? (
          <p aria-live="polite" className="text-sm font-medium text-emerald-700 sm:mr-auto">
            {success}
          </p>
        ) : null}
        <button
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          disabled={saving || !isDirty || (method === 'custom' && !customSplitIsValid)}
          onClick={() => void onSave()}
          type="button"
        >
          {saving ? copy.saving : copy.save}
        </button>
      </div>
    </section>
  );
}
