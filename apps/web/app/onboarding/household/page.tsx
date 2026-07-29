'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { joinHouseholdWithCode, skipHouseholdSetup } from '../../../lib/api';
import { TitleMark } from '../../../components/TitleMark';

/**
 * Two choices, and starting your own household is the common one. The page used
 * to lead with the invite code and offer the common path as "Skip for now" — a
 * label that read as deferrable for something permanent. Joining is now
 * recoverable from an empty household, so neither option needs a warning.
 */
export default function HouseholdOnboardingPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isCodeVisible, setIsCodeVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const isBusy = isJoining || isCreating;

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      setError('Enter the invite code you were sent.');
      return;
    }

    try {
      setError(null);
      setIsJoining(true);
      await joinHouseholdWithCode(normalizedCode);
      router.replace('/dashboard');
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Failed to join household.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleCreate = async () => {
    try {
      setError(null);
      setIsCreating(true);
      await skipHouseholdSetup();
      router.replace('/dashboard');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create household.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-10">
      <section className="w-full rounded-3xl border border-slate-200/80 bg-white p-7 shadow-sm md:p-9">
        <div className="flex items-center gap-5">
          <TitleMark className="h-10 w-10 shrink-0 rounded-xl" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Fairsplit Setup</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Set up your household</h1>
            <p className="mt-2 text-sm text-slate-600">
              A household is where you and your partner share expenses.
            </p>
          </div>
        </div>

        <div className="mt-8">
          <button
            className="w-full rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            onClick={() => void handleCreate()}
            type="button"
          >
            <span className="truncate">{isCreating ? 'Setting up...' : 'Create my household'}</span>
          </button>
          <p className="mt-2 text-sm text-slate-500">
            Start tracking your own expenses. You can invite someone from Settings whenever you like.
          </p>
        </div>

        {error ? (
          <div
            aria-live="assertive"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-6 border-t border-slate-200 pt-6">
          {isCodeVisible ? (
            <form className="space-y-3" onSubmit={(event) => void handleJoin(event)}>
              <label className="block text-sm font-medium text-slate-700" htmlFor="invite-code">
                Invite code
              </label>
              <input
                id="invite-code"
                autoComplete="off"
                autoFocus
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="e.g. AB12CD34"
                value={code}
              />
              <button
                className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy}
                type="submit"
              >
                <span className="truncate">{isJoining ? 'Joining...' : 'Join their household'}</span>
              </button>
            </form>
          ) : (
            <button
              className="text-sm font-semibold text-brand-700 underline underline-offset-4 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy}
              onClick={() => setIsCodeVisible(true)}
              type="button"
            >
              I have an invite code
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
