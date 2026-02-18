'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const SESSION_COOKIE = 'fairsplit_session';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

function parseHashParams(hash: string): URLSearchParams {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid access token format');
  }

  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const json = atob(padded);
  return JSON.parse(json) as Record<string, unknown>;
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

        const payload = decodeJwtPayload(accessToken);
        const authUserId = typeof payload.sub === 'string' ? payload.sub : null;
        const email = typeof payload.email === 'string' ? payload.email : null;

        if (!authUserId || !email) {
          throw new Error('Invalid token payload. Expected sub and email claims.');
        }

        const response = await fetch(`${API_BASE_URL}/auth/link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            authUserId,
            email,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? 'Failed to link account.');
        }

        const linked = await response.json();
        const sessionPayload = {
          userId: linked?.user?.id,
          householdId: linked?.user?.householdId,
          email: linked?.user?.email,
          authUserId: linked?.user?.authUserId,
        };

        document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(JSON.stringify(sessionPayload))}; Path=/; Max-Age=2592000; SameSite=Lax`;
        setStatus('Account linked. Redirecting...');
        router.replace('/dashboard');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Authentication failed.');
      }
    };

    void run();
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4 py-10">
      <section className="w-full rounded-3xl border border-slate-200/80 bg-white p-7 shadow-sm md:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">FairSplit</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Auth callback</h1>
        <p className="mt-4 text-sm text-slate-600">{status}</p>
      </section>
    </main>
  );
}
