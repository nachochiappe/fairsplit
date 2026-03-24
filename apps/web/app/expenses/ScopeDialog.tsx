'use client';

import { useState } from 'react';
import { ViewportModal } from '../../components/ViewportModal';
import { primaryButtonClass, secondaryButtonClass } from './expense-styles';

type ApplyScope = 'single' | 'future' | 'all';

export function ScopeDialog({
  title,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (scope: ApplyScope) => void;
}) {
  const [scope, setScope] = useState<ApplyScope>('future');

  return (
    <ViewportModal onDismiss={onCancel}>
      <div
        aria-labelledby="scope-dialog-title"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        role="dialog"
      >
        <h3 className="text-base font-semibold text-slate-900" id="scope-dialog-title">
          {title}
        </h3>
        <fieldset className="mt-3 space-y-2 text-sm text-slate-700">
          <legend className="sr-only">Select which expenses to apply this action to</legend>
          <label className="flex items-center gap-2">
            <input checked={scope === 'future'} onChange={() => setScope('future')} type="radio" />
            This and future
          </label>
          <label className="flex items-center gap-2">
            <input checked={scope === 'single'} onChange={() => setScope('single')} type="radio" />
            Only this one
          </label>
          <label className="flex items-center gap-2">
            <input checked={scope === 'all'} onChange={() => setScope('all')} type="radio" />
            Whole series
          </label>
        </fieldset>
        <div className="mt-4 flex gap-2">
          <button
            className={primaryButtonClass}
            disabled={busy}
            onClick={() => onConfirm(scope)}
            type="button"
          >
            Confirm
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
