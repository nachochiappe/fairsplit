'use client';

import { type TouchEvent, useEffect, useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { formatMoney } from '../../lib/currency';
import { type Expense } from '../../lib/api';

const MOBILE_ACTION_RAIL_WIDTH = 168;
const MOBILE_ACTION_OPEN_THRESHOLD = 56;

function getExpenseKindLabel(expense: Expense): string {
  if (expense.fixed.enabled) {
    return 'Recurring';
  }

  if (expense.installment) {
    return `Installment ${expense.installment.number}/${expense.installment.total}`;
  }

  return 'One-time';
}

function formatMobileExpenseDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date
    .toLocaleDateString('en-US', {
      day: '2-digit',
      month: 'short',
    })
    .toUpperCase();
}

function formatMobileExpenseAmount(value: string): string {
  const amount = Number(value);
  if (Number.isNaN(amount)) {
    return value;
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(amount);
}

export interface MobileExpenseCardProps {
  expense: Expense;
  isOpen: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  formatFxRate: (value: string | number) => string;
}

export function MobileExpenseCard({
  expense,
  isOpen,
  onOpenChange,
  onEdit,
  onClone,
  onDelete,
  formatFxRate,
}: MobileExpenseCardProps) {
  const touchStartXRef = useRef<number | null>(null);
  const startOffsetRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const translatedOffset = dragOffset !== 0 ? dragOffset : isOpen ? -MOBILE_ACTION_RAIL_WIDTH : 0;
  const showKindChip = Boolean(expense.installment);

  useEffect(() => {
    if (!isOpen) {
      setDragOffset(0);
    }
  }, [isOpen]);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      return;
    }

    touchStartXRef.current = event.touches[0]?.clientX ?? null;
    startOffsetRef.current = isOpen ? -MOBILE_ACTION_RAIL_WIDTH : 0;
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    const currentX = event.touches[0]?.clientX;
    if (startX === null || currentX === undefined) {
      return;
    }

    const deltaX = currentX - startX;
    const nextOffset = Math.max(-MOBILE_ACTION_RAIL_WIDTH, Math.min(0, startOffsetRef.current + deltaX));
    setDragOffset(nextOffset);
  };

  const handleTouchEnd = () => {
    const nextOpen = isOpen
      ? translatedOffset < -(MOBILE_ACTION_RAIL_WIDTH - MOBILE_ACTION_OPEN_THRESHOLD)
      : translatedOffset <= -MOBILE_ACTION_OPEN_THRESHOLD;
    setDragOffset(0);
    touchStartXRef.current = null;
    onOpenChange(nextOpen);
  };

  return (
    <div
      className="relative overflow-hidden rounded-[1.35rem] border border-slate-200 bg-slate-100/80 touch-pan-y"
      data-expense-actions
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
    >
      <div className="absolute inset-y-0 right-0 flex w-[168px] items-stretch">
        <ActionButton action="edit" className="h-full min-h-0 flex-1 rounded-none border-0 shadow-none" onClick={onEdit}>
          Edit
        </ActionButton>
        <ActionButton action="clone" className="h-full min-h-0 flex-1 rounded-none border-0 shadow-none" onClick={onClone}>
          Clone
        </ActionButton>
        <ActionButton action="delete" className="h-full min-h-0 flex-1 rounded-none border-0 shadow-none" onClick={onDelete}>
          Delete
        </ActionButton>
      </div>

      <div
        className="relative z-10 w-full rounded-[18px] border border-slate-200/95 bg-white p-4 shadow-[0_2px_6px_rgba(15,23,42,0.04)] transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${translatedOffset}px)` }}
      >
        {!isOpen ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-slate-200"
          />
        ) : null}

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-normal leading-[1.2] text-slate-900" title={expense.description}>
              {expense.description}
            </p>

            <div className="mt-3.5 flex flex-wrap gap-2">
              {showKindChip ? (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1.5 text-[12px] font-normal leading-4 text-slate-700">
                  {getExpenseKindLabel(expense)}
                </span>
              ) : null}
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1.5 text-[12px] font-normal leading-4 text-slate-700">
                {expense.categoryName}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1.5 text-[12px] font-normal leading-4 text-slate-700">
                {expense.paidByUserName}
              </span>
            </div>

            {expense.currencyCode !== 'ARS' ? (
              <p className="mt-3 text-sm text-slate-600">
                Original: {expense.currencyCode} {formatMoney(expense.amountOriginal)} @ {formatFxRate(expense.fxRateUsed)}
              </p>
            ) : null}
          </div>

          <div className="shrink-0 pr-1.5 text-right">
            <div className="flex flex-col items-end gap-3">
              <p className="whitespace-nowrap text-[12px] font-normal uppercase tracking-[0.08em] text-slate-500">
                {formatMobileExpenseDate(expense.date)}
              </p>
              <p className="text-[18px] font-normal leading-[1.05] tabular-nums text-slate-900">
                ${formatMobileExpenseAmount(expense.amountArs)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
