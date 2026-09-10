import React from 'react';
import { Tooltip } from '../info/Tooltip';
import { Icon } from '../Icons';

export interface ScenarioCardProps {
  label: string;
  value: string;
  hint?: string;
  hintIcon?: string;
}

export function ScenarioCard({ label, value, hint, hintIcon = 'info' }: Readonly<ScenarioCardProps>) {
  return (
    <article className="bg-zinc-100 border border-[#e3e3e0]/70 rounded-xl px-4 py-3 flex flex-col justify-center">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 inline-flex items-center gap-1">
        {label}
        {hint && <Tooltip text={hint}><Icon name={hintIcon} className="h-3.5 w-3.5 text-gray-400" /></Tooltip>}
      </p>
      <p className="text-lg font-bold text-gray-900 break-words">{value}</p>
    </article>
  );
}
