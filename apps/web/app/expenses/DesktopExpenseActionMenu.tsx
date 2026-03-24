'use client';

export interface DesktopExpenseActionMenuProps {
  expenseId: string;
  isOpen: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
}

const menuItemClass =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';

export function DesktopExpenseActionMenu({
  expenseId,
  isOpen,
  onOpenChange,
  onEdit,
  onClone,
  onDelete,
}: DesktopExpenseActionMenuProps) {
  const menuId = `expense-actions-${expenseId}`;

  return (
    <div className="relative inline-flex justify-end" data-expense-actions>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Open expense actions"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        onClick={() => onOpenChange(!isOpen)}
        type="button"
      >
        <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 top-full z-20 mt-2 min-w-[160px] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.14)]"
          id={menuId}
          role="menu"
        >
          <button
            className={menuItemClass}
            onClick={() => {
              onOpenChange(false);
              onEdit();
            }}
            role="menuitem"
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Edit
          </button>
          <button
            className={menuItemClass}
            onClick={() => {
              onOpenChange(false);
              onClone();
            }}
            role="menuitem"
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <rect height="13" rx="2" width="13" x="9" y="9" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Clone
          </button>
          <button
            className={`${menuItemClass} text-red-700 hover:bg-red-50 hover:text-red-700`}
            onClick={() => {
              onOpenChange(false);
              onDelete();
            }}
            role="menuitem"
            type="button"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
