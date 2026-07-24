import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../info/Tooltip';

export interface InputFieldProps {
  label: string;
  value: number | string;
  onChange: (value: string) => void;
  type?: 'number' | 'text';
  step?: string;
  hint?: string;
  disabled?: boolean;
  disabledTitle?: string;
  error?: string;
}

export function InputField({ label, value, onChange, type = 'number', step, hint, disabled, disabledTitle, error }: Readonly<InputFieldProps>) {
  const [raw, setRaw] = useState(() => String(value ?? ''));
  const isFocused = useRef(false);

  useEffect(() => {
    if (!isFocused.current) {
      setRaw(String(value ?? ''));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRaw(e.target.value);
    onChange(e.target.value);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className={`text-xs font-semibold uppercase tracking-wider ${disabled ? 'text-gray-400' : error ? 'text-red-700' : 'text-gray-600'}`}>{label}</label>
      {disabled && disabledTitle ? (
        <Tooltip text={disabledTitle}>
          <input
            type={type}
            value={raw}
            onChange={handleChange}
            onFocus={() => { isFocused.current = true; }}
            onBlur={() => { isFocused.current = false; setRaw(String(value ?? '')); }}
            step={step}
            disabled
            className={`px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all text-sm bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed w-full disabled:pointer-events-none`}
          />
        </Tooltip>
      ) : (
        <input
          type={type}
          value={raw}
          onChange={handleChange}
          onFocus={() => { isFocused.current = true; }}
          onBlur={() => { isFocused.current = false; setRaw(String(value ?? '')); }}
          step={step}
          disabled={disabled}
          className={`px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all text-sm ${
            disabled
              ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
              : error
                ? 'bg-white border-red-400 text-gray-900 focus:ring-red-400'
                : 'bg-white border-gray-300 text-gray-900 focus:ring-gray-500 focus:border-transparent'
          }`}
        />
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && hint && <p className={`text-xs ${disabled ? 'text-gray-400' : 'text-gray-500'}`}>{hint}</p>}
    </div>
  );
}
