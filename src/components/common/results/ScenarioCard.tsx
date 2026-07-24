import React from 'react';
import { Tooltip } from '../info/Tooltip';

export interface ScenarioCardProps {
  label: string;
  value: string;
  hint?: string;
  hintIcon?: string;
}

export function ScenarioCard({ label, value, hint, hintIcon = 'ℹ️' }: Readonly<ScenarioCardProps>) {
  return (
    <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 inline-flex items-center gap-1">
        {label}
        {hint && <Tooltip text={hint}>{hintIcon}</Tooltip>}
      </p>
      <p className="text-lg font-bold text-gray-900 break-words">{value}</p>
    </article>
  );
}
