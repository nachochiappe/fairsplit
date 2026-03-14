'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { joinHouseholdWithCode, skipHouseholdSetup } from '../../../lib/api';
import { TitleMark } from '../../../components/TitleMark';
import { ViewportModal } from '../../../components/ViewportModal';

export default function HouseholdOnboardingPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [isSkipDialogOpen, setIsSkipDialogOpen] = useState(false);

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      setError('Enter an invite code to join a household.');
      return;
    }

    try {
      setError(null);
      setIsSubmitting(true);
      await joinHouseholdWithCode(normalizedCode);
      router.replace('/dashboard');
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Failed to join household.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = async () => {
    try {
      setError(null);
      setIsSkipping(true);
      await skipHouseholdSetup();
      setIsSkipDialogOpen(false);
      router.replace('/dashboard');
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : 'Failed to complete setup.');
    } finally {
      setIsSkipping(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-10">
      {isSkipDialogOpen ? (
        <ViewportModal onDismiss={() => (isSkipping ? undefined : setIsSkipDialogOpen(false))}>
          <div
            aria-labelledby="skip-household-dialog-title"
            aria-modal="true"
            className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10"
            role="dialog"
          >
            <h2 className="text-xl font-semibold text-slate-900" id="skip-household-dialog-title">
              Skip household setup
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              This will create a solo household for your account. You will not be able to join another household later.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSkipping}
                onClick={() => setIsSkipDialogOpen(false)}
                type="button"
              >
                Keep setup open
              </button>
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSkipping}
                onClick={() => void handleSkip()}
                type="button"
              >
                {isSkipping ? 'Finalizing...' : 'Skip and continue'}
              </button>
            </div>
          </div>
        </ViewportModal>
      ) : null}

      <section className="w-full rounded-3xl border border-slate-200/80 bg-white p-7 shadow-sm md:p-9">
        <div className="flex items-center gap-5">
          <TitleMark className="h-10 w-10 shrink-0 rounded-xl" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Fairsplit Setup</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Join a Household</h1>
            <p className="mt-2 text-sm text-slate-600">Optional: enter an invite code from someone already in a household.</p>
          </div>
        </div>

        <form className="mt-8 space-y-4" onSubmit={(event) => void handleJoin(event)}>
          <label className="block text-sm font-medium text-slate-700" htmlFor="invite-code">
            Invite code
          </label>
          <input
            id="invite-code"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="e.g. AB12CD34"
            value={code}
          />

          {error ? (
            <div aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            className="w-full rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting || isSkipping}
            type="submit"
          >
            {isSubmitting ? 'Joining...' : 'Join household'}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-6">
          <button
            className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting || isSkipping}
            onClick={() => setIsSkipDialogOpen(true)}
            type="button"
          >
            {isSkipping ? 'Finalizing...' : 'Skip for now'}
          </button>
          <p className="mt-2 text-xs text-slate-500">Skipping creates a new household for your account and cannot be undone.</p>
        </div>
      </section>
    </main>
  );
}
