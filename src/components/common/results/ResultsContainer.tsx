export function ResultsContainer({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <section className="bg-[#fdfdfe] border border-gray-200 rounded-2xl px-6 sm:px-8 pt-6 sm:pt-8 pb-0">
        {children}
      </section>
    </main>
  );
}
