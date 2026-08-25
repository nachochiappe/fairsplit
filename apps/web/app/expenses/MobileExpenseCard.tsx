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
    <article className="relative bg-white px-3 py-3.5">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <span
          aria-hidden="true"
          className="h-8 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: expense.superCategoryColor ?? '#64748b' }}
        />
        <div className="min-w-0 flex-1 pl-1">
          <p
            className="truncate text-sm font-semibold leading-tight text-ink-strong"
            title={expense.description}
          >
            {expense.description}
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
            <span className="shrink-0 font-medium uppercase tracking-[0.06em]">
              {formatMobileExpenseDate(expense.date, locale)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{expense.categoryName}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{expense.paidByUserName}</span>
          </div>
          {showKindChip ? (
            <span className="mt-1.5 inline-flex items-center whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
              {getExpenseKindLabel(copy.expenses, expense)}
            </span>
          ) : null}
          {expense.currencyCode !== 'ARS' ? (
            <p className="mt-1 text-xs text-slate-600">
              {copy.expenses.originalAmount(
                expense.currencyCode,
                formatMoney(expense.amountOriginal, locale),
                formatFxRate(expense.fxRateUsed),
              )}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <p
            aria-hidden={isOpen}
            className={`text-sm font-bold leading-none tabular-nums text-ink-strong transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] ${
              isOpen ? '-translate-x-4 opacity-0' : 'translate-x-0 opacity-100'
            }`}
          >
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
