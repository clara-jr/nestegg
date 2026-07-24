export function ResultsContainer({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <section className="bg-white border border-gray-200 rounded-xl px-6 sm:px-8 pt-6 sm:pt-8 pb-0 shadow-sm">
        {children}
      </section>
    </main>
  );
}
