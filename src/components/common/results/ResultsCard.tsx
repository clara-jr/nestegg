export interface ResultsCardProps {
  label: string;
  value: string;
  icon: string;
}

export function ResultsCard({ label, value, icon }: Readonly<ResultsCardProps>) {
  return (
    <article className="bg-white border border-gray-200 rounded-lg p-4 transition-all hover:shadow-sm hover:border-gray-300">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl font-bold text-gray-900 break-words">{value}</p>
    </article>
  );
}
