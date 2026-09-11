import { Icon } from '../Icons';

export interface ResultsCardProps {
  label: string;
  value: string;
  icon: string;
}

export function ResultsCard({ label, value, icon }: Readonly<ResultsCardProps>) {
  return (
    <article className="bg-[#fdfdfe] border border-gray-200 rounded-xl p-4 transition-all hover:border-gray-300">
      <div className="flex items-center gap-2 mb-2">
        <Icon name={icon} className="h-4 w-4 text-gray-500" />
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl font-bold text-gray-900 break-words">{value}</p>
    </article>
  );
}
