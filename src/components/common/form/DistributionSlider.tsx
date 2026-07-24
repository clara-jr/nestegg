import React from 'react';

export interface DistributionPeriod {
  label: string;
  pct: number;
  index: number;
}

export interface DistributionSliderProps {
  title?: string;
  periods: DistributionPeriod[];
  sameForAll: boolean;
  showSameForAllToggle: boolean;
  onToggleSameForAll: (checked: boolean) => void;
  onChange: (periodIndex: number, value: number) => void;
}

export function DistributionSlider({
  title = 'Distribución por Tramos',
  periods,
  sameForAll,
  showSameForAllToggle,
  onToggleSameForAll,
  onChange,
}: Readonly<DistributionSliderProps>) {
  const displayPeriods = sameForAll ? [periods[0]].filter(Boolean) : periods;

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{title}</p>
        {showSameForAllToggle && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={sameForAll}
              onChange={(e) => onToggleSameForAll(e.target.checked)}
              className="w-3.5 h-3.5 text-gray-600 border-gray-300 rounded cursor-pointer"
            />
            <span className="text-xs font-medium text-gray-700">Igual en todos</span>
          </label>
        )}
      </div>
      {displayPeriods.map((period) => (
        <div key={sameForAll ? 'all' : `period-${period.index}`} className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-700">{period.label}</p>
            <span className="text-xs font-semibold text-gray-700">
              {period.pct}% cuenta | {100 - period.pct}% inversiones
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={period.pct}
            onChange={(e) => onChange(period.index, Number(e.target.value))}
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-gray-700"
          />
        </div>
      ))}
      <p className="text-xs text-gray-500">Cuenta ← → Inversiones</p>
    </div>
  );
}
