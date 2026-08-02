'use client';

import { memo, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const menuItemClass =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';
const MENU_WIDTH = 176;
const MENU_HEIGHT = 136;
const MENU_GAP = 8;

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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setMenuPosition(null);
        return;
      }
      const fitsBelow = rect.bottom + MENU_GAP + MENU_HEIGHT <= window.innerHeight;
      setMenuPosition({
        left: Math.max(
          MENU_GAP,
          Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - MENU_GAP),
        ),
        top: fitsBelow
          ? rect.bottom + MENU_GAP
          : Math.max(MENU_GAP, rect.top - MENU_HEIGHT - MENU_GAP),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-flex justify-end" data-expense-actions>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={copy.expenses.openActions}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        onClick={() => onOpenChange(expense, !isOpen)}
        ref={triggerRef}
        type="button"
      >
        <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>

      {isOpen && menuPosition
        ? createPortal(
            <div
              className="fixed z-[100] w-44 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.14)]"
              data-expense-actions
              id={menuId}
              role="menu"
              style={menuPosition}
            >
              <button
                className={menuItemClass}
                onClick={() => {
                  onOpenChange(expense, false);
                  onEdit(expense);
                }}
                role="menuitem"
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
                {copy.common.edit}
              </button>
              <button
                className={menuItemClass}
                onClick={() => {
                  onOpenChange(expense, false);
                  onClone(expense);
                }}
                role="menuitem"
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
                {copy.common.clone}
              </button>
              <button
                className={`${menuItemClass} text-red-700 hover:bg-red-50 hover:text-red-700`}
                onClick={() => {
                  onOpenChange(expense, false);
                  onDelete(expense);
                }}
                role="menuitem"
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
                {copy.common.delete}
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export const ExpenseActionMenu = memo(ExpenseActionMenuComponent);
