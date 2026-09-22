import type { ReactNode } from 'react';
import { useI18n } from '../../../lib/i18n';

interface NumberInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  min?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  stepperRound?: 'md' | 'xl';
  onFocus?: () => void;
  onBlur?: () => void;
}

function Arrow({ dir }: { dir: 'up' | 'down' }): ReactNode {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === 'up' ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

/** Input numérico con flechas de subir/bajar que ocupan todo el alto del campo. */
export function NumberInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  min = 0,
  step = 1,
  disabled,
  className = '',
  inputClassName = 'pr-8 py-1 pl-2 border border-gray-200 rounded-md text-sm text-right text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10',
  stepperRound = 'md',
  onFocus,
  onBlur,
}: Readonly<NumberInputProps>) {
  const { t } = useI18n();
  const topCorner = stepperRound === 'xl' ? 'rounded-tr-xl' : 'rounded-tr-md';
  const bottomCorner = stepperRound === 'xl' ? 'rounded-br-xl' : 'rounded-br-md';

  const bump = (dir: 1 | -1) => {
    const current = String(value ?? '').replace(',', '.');
    const cur = Number.parseFloat(current);
    const next = Number.isNaN(cur) ? (dir > 0 ? step : -step) : cur + dir * step;
    const clamped = Math.max(min, next);
    onChange(String(Math.round(clamped * 1e4) / 1e4));
  };

  return (
    <div className={`relative inline-flex ${className}`}>
      <input
        type="number"
        step="any"
        min={min}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        className={`w-full h-full appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${inputClassName}`}
      />
      <div className="absolute inset-y-0 right-0 flex flex-col w-6 border-l border-gray-200/70">
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('common.numberUp')}
          disabled={disabled}
          onMouseDown={e => e.preventDefault()}
          onClick={() => bump(1)}
          className={`flex-1 flex items-center justify-center text-gray-500 hover:bg-zinc-200/70 hover:text-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${topCorner}`}
        >
          <Arrow dir="up" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('common.numberDown')}
          disabled={disabled}
          onMouseDown={e => e.preventDefault()}
          onClick={() => bump(-1)}
          className={`flex-1 flex items-center justify-center text-gray-500 hover:bg-zinc-200/70 hover:text-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${bottomCorner}`}
        >
          <Arrow dir="down" />
        </button>
      </div>
    </div>
  );
}