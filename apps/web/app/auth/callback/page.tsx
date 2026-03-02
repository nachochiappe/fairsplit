'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TitleMark } from '../../../components/TitleMark';
import type { AuthLinkResponse } from '../../../lib/api';
import { SESSION_COOKIE } from '../../../lib/session';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

function parseHashParams(hash: string): URLSearchParams {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState('Linking account...');

  useEffect(() => {
    const run = async () => {
      try {
        const hash = parseHashParams(window.location.hash);
        const accessToken = hash.get('access_token');
        if (!accessToken) {
          throw new Error('Missing access token in callback URL.');
        }

        const response = await fetch(`${API_BASE_URL}/auth/link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            accessToken,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? 'Failed to link account.');
        }

        const linked = (await response.json()) as AuthLinkResponse;
        document.cookie = `${SESSION_COOKIE}=${linked.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax`;
        setStatus('Account linked. Redirecting...');
        router.replace(linked?.needsHouseholdSetup ? '/onboarding/household' : '/dashboard');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Authentication failed.');
      }
    };

    void run();
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4 py-10">
      <section className="w-full rounded-3xl border border-slate-200/80 bg-white p-7 shadow-sm md:p-9">
        <div className="flex items-center gap-6">
          <TitleMark className="h-10 w-10 shrink-0 rounded-xl" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Fairsplit</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Auth callback</h1>
            <p className="mt-4 text-sm text-slate-600">{status}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
