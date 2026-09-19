'use client';

import { useState } from 'react';
import {
  createIntegrationToken,
  deleteIntegrationToken,
  type AppLocale,
  type IntegrationToken,
} from '../../lib/api';
import { localeTags, t } from '../../lib/i18n';

interface IntegrationTokensCardProps {
  initialTokens: IntegrationToken[];
  locale: AppLocale;
}

export function IntegrationTokensCard({ initialTokens, locale }: IntegrationTokensCardProps) {
  const copy = t(locale).settings.integrationTokens;
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState('MCP');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(copy.nameRequired);
      return;
    }
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createIntegrationToken(trimmedName);
      setTokens((current) => [...current, created]);
      setCreatedToken(created.token);
      setName('MCP');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : copy.createFailed);
    } finally {
      setCreating(false);
    }
  };

  const onCopy = async () => {
    if (!createdToken) {
      return;
    }
    try {
      await navigator.clipboard.writeText(createdToken);
      setSuccess(copy.copied);
    } catch {
      setError(copy.copyFailed);
    }
  };

  const onRevoke = async (token: IntegrationToken) => {
    if (!window.confirm(`${copy.revokeConfirm} ${token.name}?`)) {
      return;
    }
    setRevokingId(token.id);
    setError(null);
    setSuccess(null);
    try {
      await deleteIntegrationToken(token.id);
      setTokens((current) => current.filter((entry) => entry.id !== token.id));
      setSuccess(copy.revoked);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : copy.revokeFailed);
    } finally {
      setRevokingId(null);
    }
  };

  const formatDate = (value: string) => new Date(value).toLocaleDateString(localeTags[locale]);

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-ink-strong">{copy.title}</h2>
      <p className="mt-1 text-sm text-ink-soft">{copy.description}</p>

      {createdToken ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">{copy.saveNow}</p>
          <code className="mt-2 block break-all rounded-lg bg-white px-3 py-2 text-xs text-ink-strong">
            {createdToken}
          </code>
          <button
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            onClick={() => void onCopy()}
            type="button"
          >
            {copy.copy}
          </button>
        </div>
      ) : null}

      {tokens.length > 0 ? (
        <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {tokens.map((token) => (
            <li
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              key={token.id}
            >
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-ink-strong">{token.name}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {token.tokenPrefix}… · {copy.createdOn(formatDate(token.createdAt))} ·{' '}
                  {token.lastUsedAt ? copy.lastUsed(formatDate(token.lastUsedAt)) : copy.neverUsed}
                </p>
              </div>
              <button
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={revokingId === token.id}
                onClick={() => void onRevoke(token)}
                type="button"
              >
                {revokingId === token.id ? copy.revoking : copy.revoke}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-soft00">{copy.empty}</p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="integration-token-name">
          {copy.namePlaceholder}
        </label>
        <input
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-ink-strong shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          id="integration-token-name"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder={copy.namePlaceholder}
          value={name}
        />
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={creating}
          onClick={() => void onCreate()}
          type="button"
        >
          {creating ? copy.creating : copy.create}
        </button>
      </div>

      {error ? (
        <div
          aria-live="assertive"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
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
