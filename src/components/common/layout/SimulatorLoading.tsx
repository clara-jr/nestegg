export function SimulatorLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-gray-100 bg-white p-5 space-y-5">
        <div className="h-4 w-40 animate-pulse rounded bg-zinc-200" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-28 animate-pulse rounded bg-zinc-200" />
              <div className="h-9 w-full animate-pulse rounded-xl bg-zinc-200" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white p-5 space-y-3">
        <div className="h-4 w-32 animate-pulse rounded bg-zinc-200" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="h-24 animate-pulse rounded-xl bg-zinc-200" />
          <div className="h-24 animate-pulse rounded-xl bg-zinc-200" />
          <div className="h-24 animate-pulse rounded-xl bg-zinc-200" />
        </div>
      </div>
    </div>
  );
}