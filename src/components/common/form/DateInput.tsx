import React, { useEffect, useRef, useState } from 'react';

export interface DateInputProps {
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DAY_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const YEAR_PAGE = 12;

/** Devuelve el nº de días del mes (0-indexed). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Día de la semana del día 1 del mes (0 = lunes … 6 = domingo). */
function firstWeekday(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return d === 0 ? 6 : d - 1; // convertir dom=0 → 6
}

function parseDate(iso: string): { year: number; month: number; day: number } | null {
  if (!iso || iso.length < 10) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

/** Parsea texto en formato DD/MM/AAAA y valida que la fecha sea real. */
function parseDMY(text: string): { year: number; month: number; day: number } | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const lastDay = daysInMonth(year, month - 1);
  if (day > lastDay) return null;
  return { year, month: month - 1, day };
}

function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDisplay(iso: string): string {
  const p = parseDate(iso);
  if (!p) return iso;
  return `${String(p.day).padStart(2, '0')}/${String(p.month + 1).padStart(2, '0')}/${p.year}`;
}

function isBefore(a: string, b: string): boolean {
  return a < b;
}
function isAfter(a: string, b: string): boolean {
  return a > b;
}

export function DateInput({ value, min, max, onChange, ariaLabel }: Readonly<DateInputProps>) {
  const parsed = parseDate(value);
  const [open, setOpen] = useState(false);
  const [showYearPick, setShowYearPick] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.year ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? new Date().getMonth());
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar al pulsar fuera
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Sincronizar la vista del calendario con el valor seleccionado
  useEffect(() => {
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
    setDraft(null);
  }, [value]);

  const toggleOpen = () => {
    setOpen(o => {
      if (!o) setShowYearPick(false);
      return !o;
    });
  };

  const clampYear = (y: number) => Math.min(MAX_YEAR, Math.max(MIN_YEAR, y));

  const navigate = (delta: number) => {
    setViewMonth(m => {
      let next = m + delta;
      if (next < 0) { setViewYear(y => clampYear(y - 1)); next = 11; }
      if (next > 11) { setViewYear(y => clampYear(y + 1)); next = 0; }
      return next;
    });
  };

  const navigateYear = (delta: number) => setViewYear(y => clampYear(y + delta));

  const selectDay = (day: number) => {
    const iso = toISO(viewYear, viewMonth, day);
    if (min && isBefore(iso, min)) return;
    if (max && isAfter(iso, max)) return;
    onChange(iso);
    setOpen(false);
    setDraft(null);
  };

  const commitDraft = () => {
    if (draft == null) return;
    const p = draft.trim() ? parseDMY(draft) : null;
    if (p) {
      const iso = toISO(p.year, p.month, p.day);
      if (!(min && isBefore(iso, min)) && !(max && isAfter(iso, max))) {
        onChange(iso);
        setDraft(null);
        return;
      }
    }
    setDraft(null); // inválido o fuera de rango → revertir
  };

  const todayISO = toISO(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const totalDays = daysInMonth(viewYear, viewMonth);
  const offset = firstWeekday(viewYear, viewMonth);
  const cells: Array<{ day: number; iso: string } | null> = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push({ day: d, iso: toISO(viewYear, viewMonth, d) });

  const yearStart = Math.floor(viewYear / YEAR_PAGE) * YEAR_PAGE;
  const yearCells = Array.from({ length: YEAR_PAGE }, (_, i) => yearStart + i);

  return (
    <div ref={ref} className="relative inline-flex items-center">
      {/* Input editable con formato DD/MM/AAAA */}
      <div className="flex items-center border border-gray-200 rounded-xl bg-[#fdfdfe] focus-within:border-gray-300">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder="DD/MM/AAAA"
          aria-label={ariaLabel ?? 'Fecha en formato DD/MM/AAAA'}
          value={draft ?? (value ? formatDisplay(value) : '')}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              commitDraft();
              setOpen(false);
            } else if (e.key === 'Escape') {
              setDraft(null);
              setOpen(false);
            }
          }}
          className="w-28 pl-3 py-1.5 text-sm text-gray-700 bg-transparent focus:outline-none placeholder:text-gray-400"
        />
        <button
          type="button"
          onClick={toggleOpen}
          aria-label="Abrir calendario"
          className="p-2 mr-1 rounded-lg text-gray-400 cursor-pointer focus:outline-none"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </div>

      {/* Panel del calendario */}
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-gray-200 bg-[#fdfdfe] p-3 shadow-lg">
          {/* Cabecera: título clicable (mes/año ↔ rango de años) + flechas */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => (showYearPick ? navigateYear(-YEAR_PAGE) : navigate(-1))}
              className="p-1 rounded hover:bg-zinc-100 text-gray-500 cursor-pointer"
              aria-label={showYearPick ? 'Años anteriores' : 'Mes anterior'}
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
            </button>
            <button
              type="button"
              onClick={() => setShowYearPick(s => !s)}
              className="px-2 py-0.5 rounded-lg hover:bg-zinc-100 text-sm font-semibold text-gray-700 select-none cursor-pointer"
              aria-label={showYearPick ? 'Volver al mes' : 'Cambiar el año'}
            >
              {showYearPick ? `${yearStart} – ${yearStart + YEAR_PAGE - 1}` : `${MONTH_NAMES[viewMonth]} ${viewYear}`}
            </button>
            <button
              type="button"
              onClick={() => (showYearPick ? navigateYear(YEAR_PAGE) : navigate(1))}
              className="p-1 rounded hover:bg-zinc-100 text-gray-500 cursor-pointer"
              aria-label={showYearPick ? 'Años siguientes' : 'Mes siguiente'}
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
            </button>
          </div>

          {showYearPick ? (
            /* Cuadrícula de años */
            <div className="grid grid-cols-4 gap-1">
              {yearCells.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setViewYear(y);
                    setShowYearPick(false);
                  }}
                  className={[
                    'h-8 flex items-center justify-center rounded-lg text-xs transition-colors',
                    y === viewYear ? 'bg-zinc-100 text-gray-900 font-semibold ring-1 ring-gray-400' : 'text-gray-700 hover:bg-zinc-100',
                  ].join(' ')}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* Cabecera: días de la semana */}
              <div className="grid grid-cols-7 mb-1">
                {DAY_HEADERS.map(h => (
                  <div key={h} className="text-center text-[10px] font-semibold text-gray-400 select-none">
                    {h}
                  </div>
                ))}
              </div>

              {/* Cuadrícula de días */}
              <div className="grid grid-cols-7">
                {cells.map((cell, i) => {
                  if (!cell) return <div key={`e${i}`} />;
                  const { day, iso } = cell;
                  const isSelected = iso === value;
                  const isToday = iso === todayISO;
                  const disabled =
                    (min != null && isBefore(iso, min)) ||
                    (max != null && isAfter(iso, max));
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={disabled}
                      onClick={() => selectDay(day)}
                      className={[
                        'h-8 w-full flex items-center justify-center rounded-xl text-xs transition-colors',
                        disabled && 'text-gray-300 cursor-not-allowed',
                        !disabled && !isSelected && 'hover:bg-zinc-100 text-gray-700',
                        isSelected && 'bg-zinc-100 text-gray-900 font-semibold',
                        !isSelected && isToday && !disabled && 'ring-1 ring-gray-400 font-semibold',
                      ].join(' ')}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}