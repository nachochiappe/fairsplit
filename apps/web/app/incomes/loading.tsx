export default function IncomesLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] items-center justify-center px-4 py-8 md:px-6 md:py-10">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-700 shadow-sm">
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700"
        />
        Loading incomes...
      </div>
    </main>
  );
}
