import Link from 'next/link';
import { TitleMark } from '../components/TitleMark';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10">
      <section className="w-full rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-sm backdrop-blur">
        <h1 className="flex items-center gap-3 text-xl font-semibold text-slate-900">
          <TitleMark className="h-7 w-7 shrink-0 rounded-md" />
          <span>Page not found</span>
        </h1>
        <p className="mt-2 text-sm text-slate-600">The page you requested does not exist or was moved.</p>
        <Link
          className="mt-4 inline-flex rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          href="/dashboard"
        >
          Go to dashboard
        </Link>
      </section>
    </main>
  );
}
