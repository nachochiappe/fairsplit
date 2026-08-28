'use client';

import { useEffect, useState } from 'react';
import { deletePasskey, type AppLocale, type Passkey } from '../../lib/api';
import { localeTags, t } from '../../lib/i18n';
import { PasskeyCancelledError, isPasskeySupported, registerPasskey } from '../../lib/passkeys';

interface PasskeysCardProps {
  locale: AppLocale;
  configured: boolean;
  initialPasskeys: Passkey[];
}

export function PasskeysCard({ configured, initialPasskeys, locale }: PasskeysCardProps) {
  const copy = t(locale).settings.passkeys;
  const [passkeys, setPasskeys] = useState<Passkey[]>(initialPasskeys);
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Resolved after mount: `navigator.credentials` does not exist during SSR, so
  // rendering the unsupported notice on the server would flash it for everyone.
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(isPasskeySupported());
  }, []);

  const onAdd = async () => {
    setAdding(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await registerPasskey(label);
      setPasskeys((current) => [...current, created]);
      setLabel('');
      setSuccess(copy.added);
    } catch (addError) {
      if (addError instanceof PasskeyCancelledError) {
        return;
      }
      setError(addError instanceof Error ? addError.message : copy.addFailed);
    } finally {
      setAdding(false);
    }
  };

  const onRemove = async (passkey: Passkey) => {
    if (!window.confirm(`${copy.removeTitle}: ${copy.removeBefore}${passkey.label}${copy.removeAfter}`)) {
      return;
    }
    setRemovingId(passkey.id);
    setError(null);
    setSuccess(null);
    try {
      await deletePasskey(passkey.id);
      setPasskeys((current) => current.filter((entry) => entry.id !== passkey.id));
      setSuccess(copy.removed);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : copy.removeFailed);
    } finally {
      setRemovingId(null);
    }
  };

  const formatDate = (value: string) => new Date(value).toLocaleDateString(localeTags[locale]);
  const canAdd = configured && supported === true;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-ink-strong">{copy.title}</h2>
      <p className="mt-1 text-sm text-ink-soft00">{copy.description}</p>

      {!configured ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {copy.unconfigured}
        </p>
      ) : supported === false ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {copy.unsupported}
        </p>
      ) : null}

      {passkeys.length > 0 ? (
        <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {passkeys.map((passkey) => (
            <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" key={passkey.id}>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-ink-strong">{passkey.label}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {passkey.backedUp ? copy.synced : copy.deviceOnly} · {copy.addedOn(formatDate(passkey.createdAt))} ·{' '}
                  {passkey.lastUsedAt ? copy.lastUsed(formatDate(passkey.lastUsedAt)) : copy.neverUsed}
                </p>
              </div>
              <button
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-ink-base hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={removingId === passkey.id}
                onClick={() => void onRemove(passkey)}
                type="button"
              >
                {removingId === passkey.id ? copy.removing : copy.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-soft00">{copy.empty}</p>
      )}

      {canAdd ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="passkey-label">
            {copy.labelPlaceholder}
          </label>
          <input
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-ink-strong00 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            id="passkey-label"
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={copy.labelPlaceholder}
            value={label}
          />
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={adding}
            onClick={() => void onAdd()}
            type="button"
          >
            <span className="truncate">{adding ? copy.adding : copy.add}</span>
          </button>
        </div>
      ) : null}

      {error ? (
        <div aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {success ? (
        <div
          aria-live="polite"
          className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"
        >
          {success}
        </div>
      ) : null}
    </div>
  );
}
