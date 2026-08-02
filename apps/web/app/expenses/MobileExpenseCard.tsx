'use client';

import { memo } from 'react';
import { formatMoney } from '../../lib/currency';
import { type AppLocale, type Expense } from '../../lib/api';
import { localeTags, t, type Translation } from '../../lib/i18n';
import { ExpenseActionMenu } from './ExpenseActionMenu';

function getExpenseKindLabel(copy: Translation['expenses'], expense: Expense): string {
  if (expense.fixed.enabled) {
    return copy.kindRecurring;
  }

  if (expense.installment) {
    return copy.kindInstallment(expense.installment.number, expense.installment.total);
  }

  return copy.kindOneTime;
}

function formatMobileExpenseDate(value: string, locale: AppLocale): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date
    .toLocaleDateString(localeTags[locale], {
      day: '2-digit',
      month: 'short',
    })
    .toUpperCase();
}

function formatMobileExpenseAmount(value: string, locale: AppLocale): string {
  const amount = Number(value);
  if (Number.isNaN(amount)) {
    return value;
  }

  return new Intl.NumberFormat(localeTags[locale], {
    maximumFractionDigits: 0,
  }).format(amount);
}

export interface MobileExpenseCardProps {
  expense: Expense;
  isOpen: boolean;
  locale: AppLocale;
  // Handlers take the expense so the parent can pass stable callbacks instead of
  // allocating a closure per row, which would defeat the memo below.
  onOpenChange: (expense: Expense, nextOpen: boolean) => void;
  onEdit: (expense: Expense) => void;
  onClone: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
  formatFxRate: (value: string | number) => string;
}

function MobileExpenseCardComponent({
  expense,
  isOpen,
  locale,
  onOpenChange,
  onEdit,
  onClone,
  onDelete,
  formatFxRate,
}: MobileExpenseCardProps) {
  const copy = t(locale);
  const showKindChip = Boolean(expense.installment);

  return (
    <article className="relative rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-[0_2px_6px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-semibold leading-tight text-ink-strong"
            title={expense.description}
          >
            {expense.description}
          </p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.08em] text-ink-soft">
            {formatMobileExpenseDate(expense.date, locale)}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {showKindChip ? (
              <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                {getExpenseKindLabel(copy.expenses, expense)}
              </span>
            ) : null}
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {expense.categoryName}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {expense.paidByUserName}
            </span>
          </div>

          {expense.currencyCode !== 'ARS' ? (
            <p className="mt-3 text-xs text-slate-600">
              {copy.expenses.originalAmount(
                expense.currencyCode,
                formatMoney(expense.amountOriginal, locale),
                formatFxRate(expense.fxRateUsed),
              )}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-2">
          <p className="pt-2 text-lg font-bold leading-none tabular-nums text-ink-strong">
            ${formatMobileExpenseAmount(expense.amountArs, locale)}
          </p>
          <ExpenseActionMenu
            expense={expense}
            isOpen={isOpen}
            locale={locale}
            onClone={onClone}
            onDelete={onDelete}
            onEdit={onEdit}
            onOpenChange={onOpenChange}
          />
        </div>
      </div>
    </article>
  );
}

export const MobileExpenseCard = memo(MobileExpenseCardComponent);
