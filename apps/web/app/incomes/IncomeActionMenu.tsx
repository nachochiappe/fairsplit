'use client';

import { memo } from 'react';
import { type AppLocale } from '../../lib/api';
import { t } from '../../lib/i18n';

interface IncomeActionMenuProps {
  description: string;
  disabled: boolean;
  isOpen: boolean;
  menuKey: string;
  locale: AppLocale;
  onDelete: () => void;
  onEdit: () => void;
  onOpenChange: (nextOpen: boolean) => void;
}

const actionButtonClass =
  'income-action-button absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

function IncomeActionMenuComponent({
  description,
  disabled,
  isOpen,
  menuKey,
  locale,
  onDelete,
  onEdit,
  onOpenChange,
}: IncomeActionMenuProps) {
  const copy = t(locale);
  const menuId = `income-actions-${menuKey}`;

  const runAction = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <div
      className={`relative inline-flex h-11 w-11 shrink-0 justify-end ${isOpen ? 'z-20' : 'z-0'}`}
      data-income-actions
    >
      <span
        aria-hidden="true"
        className={`absolute right-0 top-0 h-11 w-[132px] origin-right rounded-full border border-slate-200 bg-slate-50/95 shadow-[0_8px_20px_rgba(15,23,42,0.08)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? 'scale-x-100 opacity-100' : 'scale-x-25 opacity-0'
        }`}
      />

      <div
        aria-hidden={!isOpen}
        className="absolute right-0 top-0 h-11 w-[132px]"
        id={menuId}
        role="menu"
      >
        <button
          aria-label={copy.common.edit}
          className={`${actionButtonClass} hover:bg-white hover:text-brand-700 ${
            isOpen
              ? '-translate-x-11 scale-100 opacity-100 delay-[40ms]'
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
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
          </svg>
        </button>

        <button
          aria-label={copy.common.delete}
          className={`${actionButtonClass} hover:bg-rose-50 hover:text-rose-700 ${
            isOpen
              ? 'translate-x-0 scale-100 opacity-100 delay-[75ms]'
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
        aria-label={copy.incomes.moreActionsFor(description)}
        className={`income-action-trigger absolute right-0 top-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          isOpen
            ? '-translate-x-[88px] border-transparent bg-transparent shadow-none'
            : 'translate-x-0 border-transparent bg-transparent shadow-none hover:bg-slate-100 hover:text-ink-strong'
        }`}
        disabled={disabled}
        onClick={() => onOpenChange(!isOpen)}
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

export const IncomeActionMenu = memo(IncomeActionMenuComponent);
