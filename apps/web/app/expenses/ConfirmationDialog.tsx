'use client';

import { ViewportModal } from '../../components/ViewportModal';
import { primaryButtonClass, secondaryButtonClass } from './expense-styles';

export function ConfirmationDialog({
  title,
  message,
  busy,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  busy: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ViewportModal onDismiss={onCancel}>
      <div
        aria-labelledby="confirmation-dialog-title"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        role="dialog"
      >
        <h3 className="text-base font-semibold text-slate-900" id="confirmation-dialog-title">
          {title}
        </h3>
        <p className="mt-2 text-sm text-slate-700">{message}</p>
        <div className="mt-4 flex gap-2">
          <button
            className={primaryButtonClass}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
          <button
            className={secondaryButtonClass}
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </ViewportModal>
  );
}
