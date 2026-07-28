'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TitleMark } from '../../components/TitleMark';
import { PasskeyCancelledError, isPasskeySupported, signInWithPasskey } from '../../lib/passkeys';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  // Resolved after mount so the button is not rendered during SSR, where
  // `navigator.credentials` is unavailable and support cannot be detected.
  const [passkeySupported, setPasskeySupported] = useState(false);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasSupabaseConfig = useMemo(() => Boolean(supabaseUrl && supabaseAnonKey), [supabaseUrl, supabaseAnonKey]);

  useEffect(() => {
    if (window.location.hash.includes('access_token=')) {
      router.replace(`/auth/callback${window.location.hash}`);
    }
  }, [router]);

  useEffect(() => {
    setPasskeySupported(isPasskeySupported());
  }, []);

  const onPasskeySignIn = async () => {
    setPasskeySubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await signInWithPasskey();
      router.replace(result.needsHouseholdSetup ? '/onboarding/household' : '/dashboard');
    } catch (passkeyError) {
      if (passkeyError instanceof PasskeyCancelledError) {
        return;
      }
      setError(passkeyError instanceof Error ? passkeyError.message : 'Failed to sign in with a passkey');
    } finally {
      setPasskeySubmitting(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasSupabaseConfig || !supabaseUrl || !supabaseAnonKey) {
      setError('Missing Supabase env vars. Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const otpUrl = new URL(`${supabaseUrl}/auth/v1/otp`);
      otpUrl.searchParams.set('redirect_to', redirectTo);

      const response = await fetch(otpUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          create_user: true,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.msg ?? payload?.error_description ?? payload?.error ?? 'Failed to send magic link');
      }

      setMessage('Magic link sent. Open your email and continue from the link.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to send magic link');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4 py-10">
      <section className="w-full rounded-3xl border border-slate-200/80 bg-white p-7 shadow-sm md:p-9">
        <div className="flex items-center gap-6">
          <TitleMark className="h-10 w-10 shrink-0 rounded-xl" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Fairsplit</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Sign in</h1>
            <p className="mt-2 text-sm text-slate-600">Enter your email to receive a magic link.</p>
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-base text-slate-900"
            placeholder="you@example.com"
            autoComplete="email"
          />

          <button
            type="submit"
            disabled={submitting || !hasSupabaseConfig}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="truncate">{submitting ? 'Sending link...' : 'Send magic link'}</span>
          </button>
        </form>

        {passkeySupported ? (
          <>
            <div className="mt-6 flex items-center gap-3" role="presentation">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">or</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <button
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-base font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={passkeySubmitting}
              onClick={() => void onPasskeySignIn()}
              type="button"
            >
              <svg aria-hidden="true" className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M12.5 2a4.5 4.5 0 0 0-2.03 8.52c.02.35.03.7.03 1.05a1 1 0 0 1-.3.71l-.9.9a1 1 0 0 0 0 1.42l.9.9-.9.9a1 1 0 0 0 0 1.41l1.3 1.3a1 1 0 0 0 1.7-.7V10.5A4.5 4.5 0 0 0 12.5 2Zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
                <path d="M6.5 4a4.5 4.5 0 0 0-3.2 7.66 1 1 0 0 0 1.43-1.4A2.5 2.5 0 1 1 9 8.5a1 1 0 0 0 2 0A4.5 4.5 0 0 0 6.5 4Z" />
              </svg>
              <span className="truncate">
                {passkeySubmitting ? 'Waiting for your device...' : 'Sign in with a passkey'}
              </span>
            </button>
            <p className="mt-2 text-xs text-slate-500">
              Set one up from Settings after signing in with a magic link.
            </p>
          </>
        ) : null}

        {message ? <p className="mt-4 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

        {!hasSupabaseConfig ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Supabase env vars are missing in your web app environment.
          </p>
        ) : null}
      </section>
    </main>
  );
}
