import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../info/Tooltip';
import { NumberInput } from './NumberInput';

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

  const numberClasses = (base: string) =>
    `${base} pr-12 pl-3.5 py-2.5 rounded-xl focus:outline-none transition-all text-sm border w-full`;

  return (
    <div className="flex flex-col gap-1.5">
      <label className={`text-xs font-semibold uppercase tracking-wider ${disabled ? 'text-gray-400' : error ? 'text-red-700' : 'text-gray-600'}`}>{label}</label>
      {disabled && disabledTitle ? (
        <Tooltip text={disabledTitle}>
          {type === 'number' ? (
            <NumberInput
              value={raw}
              onChange={(v) => { setRaw(v); onChange(v); }}
              onFocus={() => { isFocused.current = true; }}
              onBlur={() => { isFocused.current = false; setRaw(String(value ?? '')); }}
              step={step ? Number(step) : 1}
              disabled
              className="w-full"
              inputClassName={numberClasses('bg-zinc-100 border-gray-200 text-gray-400 cursor-not-allowed')}
              stepperRound="xl"
            />
          ) : (
            <input
              type={type}
              value={raw}
              onChange={handleChange}
              onFocus={() => { isFocused.current = true; }}
              onBlur={() => { isFocused.current = false; setRaw(String(value ?? '')); }}
              step={step}
              disabled
              className="px-3.5 py-2.5 border rounded-xl focus:outline-none transition-all text-sm bg-zinc-100 border-gray-200 text-gray-400 cursor-not-allowed w-full disabled:pointer-events-none"
            />
          )}
        </Tooltip>
      ) : type === 'number' ? (
        <NumberInput
          value={raw}
          onChange={(v) => { setRaw(v); onChange(v); }}
          onFocus={() => { isFocused.current = true; }}
          onBlur={() => { isFocused.current = false; setRaw(String(value ?? '')); }}
          step={step ? Number(step) : 1}
          disabled={disabled}
          className="w-full"
          inputClassName={numberClasses(
            disabled
              ? 'bg-zinc-100 border-gray-200 text-gray-400 cursor-not-allowed'
              : error
                ? 'bg-[#fdfdfe] border-red-400 text-gray-900'
                : 'bg-[#fdfdfe] border-gray-200 text-gray-900 focus:border-gray-300'
          )}
          stepperRound="xl"
        />
      ) : (
        <input
          type={type}
          value={raw}
          onChange={handleChange}
          onFocus={() => { isFocused.current = true; }}
          onBlur={() => { isFocused.current = false; setRaw(String(value ?? '')); }}
          step={step}
          disabled={disabled}
          className={`px-3.5 py-2.5 border rounded-xl focus:outline-none transition-all text-sm ${
            disabled
              ? 'bg-zinc-100 border-gray-200 text-gray-400 cursor-not-allowed'
              : error
                ? 'bg-[#fdfdfe] border-red-400 text-gray-900'
                : 'bg-[#fdfdfe] border-gray-200 text-gray-900 focus:border-gray-300'
          }`}
        />
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && hint && <p className={`text-xs ${disabled ? 'text-gray-400' : 'text-gray-500'}`}>{hint}</p>}
    </div>
  );
}
