export function SimulatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen py-6 px-3 mb-4 sm:px-4 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-6 md:gap-8">
          {children}
        </div>
      </div>
    </div>
  );
}
