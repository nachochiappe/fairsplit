type AppRouteSkeletonVariant = 'dashboard' | 'incomes' | 'expenses' | 'settings';

const contentRows: Record<AppRouteSkeletonVariant, number> = {
  dashboard: 4,
  incomes: 3,
  expenses: 6,
  settings: 5,
};

export function AppRouteSkeleton({ variant }: { variant: AppRouteSkeletonVariant }) {
  return (
    <main
      aria-busy="true"
      aria-label="Loading page"
      className="mx-auto min-h-screen w-full max-w-[1400px] px-4 pb-28 pt-5 md:px-6 md:pb-10 md:pt-7"
    >
      <header className="mb-5 flex flex-col gap-4 rounded-3xl border border-stroke/80 bg-surface px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-brand-100" />
          <div className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded-full bg-brand-100" />
            <div className="h-7 w-44 animate-pulse rounded-lg bg-slate-200" />
          </div>
        </div>
        {variant !== 'settings' ? (
          <div className="h-11 w-full animate-pulse rounded-xl bg-slate-100 sm:w-56" />
        ) : null}
      </header>

      <div
        aria-hidden="true"
        className="mb-5 hidden grid-cols-4 gap-2 rounded-3xl border border-stroke/80 bg-surface p-2 shadow-sm md:grid"
      >
        {Array.from({ length: 4 }, (_, index) => (
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" key={index} />
        ))}
      </div>

      <section className="rounded-3xl border border-stroke/80 bg-surface p-4 shadow-sm md:p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: contentRows[variant] }, (_, index) => (
            <div
              className={`animate-pulse rounded-2xl bg-slate-100 ${index === 0 && variant !== 'dashboard' ? 'md:col-span-2 xl:col-span-3' : ''} ${variant === 'expenses' ? 'h-24' : 'h-32'}`}
              key={index}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
