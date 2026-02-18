'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const SESSION_COOKIE = 'fairsplit_session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasSupabaseConfig = useMemo(() => Boolean(supabaseUrl && supabaseAnonKey), [supabaseUrl, supabaseAnonKey]);

  useEffect(() => {
    if (window.location.hash.includes('access_token=')) {
      router.replace(`/auth/callback${window.location.hash}`);
      return;
    }

    if (document.cookie.includes(`${SESSION_COOKIE}=`)) {
      router.replace('/dashboard');
    }
  }, [router]);

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
      const response = await fetch(`${supabaseUrl}/auth/v1/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          create_user: true,
          options: {
            emailRedirectTo: redirectTo,
          },
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
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">FairSplit</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">Enter your email to receive a magic link.</p>

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
            {submitting ? 'Sending link...' : 'Send magic link'}
          </button>
        </form>

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
