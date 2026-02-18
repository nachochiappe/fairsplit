'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="text-slate-900">
        <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10">
          <section className="w-full rounded-2xl border border-red-200 bg-white/95 p-6 shadow-sm backdrop-blur">
            <h1 className="text-xl font-semibold">Application error</h1>
            <p className="mt-2 text-sm text-slate-600">A critical error occurred while rendering the app shell.</p>
            <button
              className="mt-4 rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              onClick={() => reset()}
              type="button"
            >
              Retry
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
