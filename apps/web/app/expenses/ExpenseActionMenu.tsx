'use client';

import { memo } from 'react';
import { type AppLocale, type Expense } from '../../lib/api';
import { t } from '../../lib/i18n';

export interface ExpenseActionMenuProps {
  expense: Expense;
  isOpen: boolean;
  locale: AppLocale;
  onOpenChange: (expense: Expense, nextOpen: boolean) => void;
  onEdit: (expense: Expense) => void;
  onClone: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}

const actionButtonClass =
  'expense-action-button absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:h-9 md:w-9';

function ExpenseActionMenuComponent({
  expense,
  isOpen,
  locale,
  onOpenChange,
  onEdit,
  onClone,
  onDelete,
}: ExpenseActionMenuProps) {
  const menuId = `expense-actions-${expense.id}`;
  const copy = t(locale);

  const runAction = (action: (expense: Expense) => void) => {
    onOpenChange(expense, false);
    action(expense);
  };

  return (
    <div
      className={`relative inline-flex h-11 w-11 shrink-0 justify-end md:h-9 md:w-9 ${isOpen ? 'z-20' : 'z-0'}`}
      data-expense-actions
    >
      <span
        aria-hidden="true"
        className={`absolute right-0 top-0 h-11 w-44 origin-right rounded-full border border-slate-200 bg-slate-50/95 shadow-[0_8px_20px_rgba(15,23,42,0.08)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:h-9 md:w-36 ${
          isOpen ? 'scale-x-100 opacity-100' : 'scale-x-25 opacity-0'
        }`}
      />

      <div
        aria-hidden={!isOpen}
        className="absolute right-0 top-0 h-11 w-44 md:h-9 md:w-36"
        id={menuId}
        role="menu"
      >
        <button
          aria-label={copy.common.edit}
          className={`${actionButtonClass} hover:bg-white hover:text-brand-700 ${
            isOpen
              ? '-translate-x-[88px] scale-100 opacity-100 delay-[35ms] md:-translate-x-[72px]'
              : 'translate-x-0 scale-75 opacity-0 delay-0'
          }`}
          data-label={copy.common.edit}
          onClick={() => runAction(onEdit)}
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
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
            <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>

        <button
          aria-label={copy.common.clone}
          className={`${actionButtonClass} hover:bg-white hover:text-brand-700 ${
            isOpen
              ? '-translate-x-11 scale-100 opacity-100 delay-[65ms] md:-translate-x-9'
              : 'translate-x-0 scale-75 opacity-0 delay-0'
          }`}
          data-label={copy.common.clone}
          onClick={() => runAction(onClone)}
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
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
            <rect height="13" rx="2" width="13" x="9" y="9" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>

        <button
          aria-label={copy.common.delete}
          className={`${actionButtonClass} hover:bg-red-50 hover:text-red-700 ${
            isOpen
              ? 'translate-x-0 scale-100 opacity-100 delay-[95ms]'
              : 'translate-x-0 scale-75 opacity-0 delay-0'
          }`}
          data-label={copy.common.delete}
          onClick={() => runAction(onDelete)}
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
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
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      </div>

      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={copy.expenses.openActions}
        className={`expense-action-trigger absolute right-0 top-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border text-slate-500 transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:h-9 md:w-9 ${
          isOpen
            ? '-translate-x-[132px] border-transparent bg-transparent opacity-100 shadow-none md:-translate-x-[108px]'
            : 'translate-x-0 border-transparent bg-transparent opacity-100 shadow-none hover:bg-slate-100 hover:text-slate-700 md:border-slate-200 md:bg-white md:opacity-0 md:shadow-sm md:hover:border-slate-300 md:hover:bg-slate-50 md:group-hover:opacity-100 md:focus-visible:opacity-100'
        }`}
        onClick={() => onOpenChange(expense, !isOpen)}
        type="button"
      >
        <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="19" cy="12" r="1.9" />
        </svg>
      </button>
    </div>
  );
}

export const ExpenseActionMenu = memo(ExpenseActionMenuComponent);
