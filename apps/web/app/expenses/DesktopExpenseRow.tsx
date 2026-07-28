'use client';

import { memo } from 'react';
import { formatMoney } from '../../lib/currency';
import { type AppLocale, type Expense } from '../../lib/api';
import type { Translation } from '../../lib/i18n';
import { DesktopExpenseActionMenu } from './DesktopExpenseActionMenu';

type ExpensesCopy = Translation['expenses'];

function getExpenseKindLabel(copy: ExpensesCopy, expense: Expense): string {
  if (expense.fixed.enabled) {
    return copy.kindRecurring;
  }
  if (expense.installment) {
    return copy.kindInstallment(expense.installment.number, expense.installment.total);
  }
  return copy.kindOneTime;
}

export interface DesktopExpenseRowProps {
  expense: Expense;
  copy: ExpensesCopy;
  locale: AppLocale;
  isOpen: boolean;
  formatFxRate: (value: string | number) => string;
  onOpenChange: (expense: Expense, nextOpen: boolean) => void;
  onEdit: (expense: Expense) => void;
  onClone: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}

function DesktopExpenseRowComponent({
  expense,
  copy,
  locale,
  isOpen,
  formatFxRate,
  onOpenChange,
  onEdit,
  onClone,
  onDelete,
}: DesktopExpenseRowProps) {
  return (
    <tr className="hover:bg-slate-50/80">
      <td className="whitespace-nowrap px-4 py-3">{expense.date}</td>
      <td className="px-4 py-3">
        <div className="truncate font-medium text-slate-900" title={expense.description}>
          {expense.description}
        </div>
        <div className="truncate text-xs text-slate-500">{getExpenseKindLabel(copy, expense)}</div>
      </td>
      <td className="px-4 py-3">{expense.categoryName}</td>
      <td className="px-4 py-3 tabular-nums">
        <div>ARS {formatMoney(expense.amountArs, locale)}</div>
        {expense.currencyCode !== 'ARS' ? (
          <div className="text-xs text-slate-500">
            {copy.originalAmount(
              expense.currencyCode,
              formatMoney(expense.amountOriginal, locale),
              formatFxRate(expense.fxRateUsed),
            )}
          </div>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-4 py-3">{expense.paidByUserName}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <DesktopExpenseActionMenu
          expense={expense}
          isOpen={isOpen}
          locale={locale}
          onClone={onClone}
          onDelete={onDelete}
          onEdit={onEdit}
          onOpenChange={onOpenChange}
        />
      </td>
    </tr>
  );
}

export const DesktopExpenseRow = memo(DesktopExpenseRowComponent);
