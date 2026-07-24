import React from 'react';

export interface SingleRangeSliderProps {
  title: string;
  value: number;
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  valueLabel: string;
  description?: string;
  footer?: string;
  fullWidth?: boolean;
  headerClassName?: string;
  onChange: (value: number) => void;
}

export function SingleRangeSlider({
  title,
  value,
  min = 0,
  max = 100,
  minLabel,
  maxLabel,
  valueLabel,
  description,
  footer,
  fullWidth = false,
  headerClassName,
  onChange,
}: Readonly<SingleRangeSliderProps>) {
  const hasRangeLabels = minLabel !== undefined && maxLabel !== undefined;

  return (
    <div className={`bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3${fullWidth ? ' md:col-span-2' : ''}`}>
      <div className="space-y-2">
        {hasRangeLabels ? (
          <>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{title}</p>
            <div className={`flex items-center justify-between${headerClassName ? ` ${headerClassName}` : ''}`}>
              <span className="text-xs text-gray-500">{minLabel}</span>
              <span className="text-lg font-bold text-gray-900">{valueLabel}</span>
              <span className="text-xs text-gray-500">{maxLabel}</span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{title}</p>
            <span className="text-xs font-semibold text-gray-700">{valueLabel}</span>
          </div>
        )}
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-gray-700"
        />
      </div>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      {footer && <p className="text-xs text-gray-500">{footer}</p>}
    </div>
  );
}
