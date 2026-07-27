'use client';

import { useState } from 'react';
import { ViewportModal } from '../../components/ViewportModal';
import { primaryButtonClass, secondaryButtonClass } from './expense-styles';
import { type AppLocale } from '../../lib/api';
import { t } from '../../lib/i18n';

type ApplyScope = 'single' | 'future' | 'all';

export function ScopeDialog({
  title,
  busy,
  locale,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  locale: AppLocale;
  onCancel: () => void;
  onConfirm: (scope: ApplyScope) => void;
}) {
  const [scope, setScope] = useState<ApplyScope>('future');
  const copy = t(locale).expenses.dialogs;
  const shared = t(locale).common;

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
          <legend className="sr-only">{copy.scopeLegend}</legend>
          <label className="flex items-center gap-2">
            <input checked={scope === 'future'} onChange={() => setScope('future')} type="radio" />
            {copy.scopeFuture}
          </label>
          <label className="flex items-center gap-2">
            <input checked={scope === 'single'} onChange={() => setScope('single')} type="radio" />
            {copy.scopeSingle}
          </label>
          <label className="flex items-center gap-2">
            <input checked={scope === 'all'} onChange={() => setScope('all')} type="radio" />
            {copy.scopeAll}
          </label>
        </fieldset>
        <div className="mt-4 flex gap-2">
          <button
            className={primaryButtonClass}
            disabled={busy}
            onClick={() => onConfirm(scope)}
            type="button"
          >
            {shared.confirm}
          </button>
          <button
            className={secondaryButtonClass}
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {shared.cancel}
          </button>
        </div>
      </div>
    </ViewportModal>
  );
}
