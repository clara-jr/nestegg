import { useState } from 'react';
import { currentMonthKey } from '../../../lib/investments';
import { DateInput } from './DateInput';
import { Select } from './Select';

/** Intervalo de meses a mostrar en una gráfica. `null` significa sin filtrar. */
export interface DateRange {
  from: string;
  to: string;
}

export type DateRangePreset = 'all' | 'month' | '6m' | 'year' | 'custom';

export interface DateRangeFilterProps {
  /** Mes más antiguo disponible (YYYY-MM). */
  min: string;
  /** Mes más reciente disponible (YYYY-MM); límite del selector personalizado. */
  max: string;
  /** Límites del intervalo «Sin filtro de tiempo» (YYYY-MM, mes completo primero
   *  y último completo). Si se pasan, «Personalizado» arranca con estos valores
   *  exactos para que las medias coincidan. */
  defaultFrom?: string;
  defaultTo?: string;
  /** Notifica el intervalo activo (null = todo). */
  onChange: (range: DateRange | null) => void;
  /** Clases adicionales para el contenedor. */
  className?: string;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Día inicial (un mes se abre en el día 1) válido para <input type="date">. */
function dayOf(value: string): string {
  return value.length === 10 ? value : `${value}-01`;
}

/** Día final (un mes se cierra en su último día) válido para <input type="date">. */
function lastDayOf(value: string): string {
  if (value.length === 10) return value;
  const [y, m] = value.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${value}-${String(last).padStart(2, '0')}`;
}

/** Fecha de hoy en formato (YYYY-MM-DD). */
function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const PRESET_LABELS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'all', label: 'Sin filtro de tiempo' },
  { value: 'month', label: 'Último mes' },
  { value: '6m', label: 'Últimos 6 meses' },
  { value: 'year', label: 'Último año' },
  { value: 'custom', label: 'Personalizado' },
];

/** Selector de intervalo de fechas para las gráficas: predefinidos (último
 *  mes, 6 meses, año, todo) o un rango personalizado de meses. */
export function DateRangeFilter({ min, max, defaultFrom, defaultTo, onChange, className = '' }: DateRangeFilterProps) {
  const [preset, setPreset] = useState<DateRangePreset>('all');
  const [customFrom, setCustomFrom] = useState(dayOf(min));
  const [customTo, setCustomTo] = useState(lastDayOf(max));

  const selectPreset = (p: DateRangePreset) => {
    setPreset(p);
    // Los predefinidos se anclan al mes CALENDARIO EN CURSO (no al último mes
    // con datos): "últimos 6 meses" siempre acaba en el mes actual aunque aún
    // no haya movimientos, para no desplazar la ventana al mes anterior.
    if (p === 'all') onChange(null);
    else if (p === 'month') onChange({ from: currentMonthKey(), to: currentMonthKey() });
    else if (p === '6m') onChange({ from: shiftMonth(currentMonthKey(), -5), to: currentMonthKey() });
    else if (p === 'year') onChange({ from: shiftMonth(currentMonthKey(), -11), to: currentMonthKey() });
    else if (p === 'custom') {
      // Al abrir «Personalizado» se cargan por defecto los límites del
      // intervalo «Sin filtro de tiempo» (primer y último mes completo), de
      // modo que las medias coincidan mientras no se muevan las fechas.
      const from = dayOf(defaultFrom ?? min);
      const to = lastDayOf(defaultTo ?? max);
      setCustomFrom(from);
      setCustomTo(to);
      onChange({ from, to });
    }
  };

  const applyCustom = (from: string, to: string) => {
    onChange({ from, to });
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Select
        value={preset}
        onChange={v => selectPreset(v as DateRangePreset)}
        ariaLabel="Filtro de tiempo"
        className="w-50"
        options={PRESET_LABELS.map(o => ({ value: o.value, label: o.label }))}
      />
      {preset === 'custom' && (
        <>
          <DateInput
            value={customFrom}
            min={dayOf(defaultFrom ?? min)}
            max={customTo}
            ariaLabel="Fecha inicio"
            onChange={from => {
              const to = from > customTo ? from : customTo;
              setCustomFrom(from);
              setCustomTo(to);
              applyCustom(from, to);
            }}
          />
          <span className="text-sm text-gray-400">→</span>
          <DateInput
            value={customTo}
            min={customFrom}
            max={todayISO()}
            ariaLabel="Fecha fin"
            onChange={to => {
              const from = to < customFrom ? to : customFrom;
              setCustomFrom(from);
              setCustomTo(to);
              applyCustom(from, to);
            }}
          />
        </>
      )}
    </div>
  );
}