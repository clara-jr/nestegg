import { useState } from 'react';
import { useI18n } from '../../../lib/i18n';
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

/** Día inicial (un mes se abre en el día 1) válido para <input type="date">. */
export function dayOf(value: string): string {
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

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const PRESET_LABELS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'all', label: 'Sin filtro de tiempo' },
  { value: 'month', label: 'Último mes' },
  { value: '6m', label: 'Últimos 6 meses' },
  { value: 'year', label: 'Último año' },
  { value: 'custom', label: 'Personalizado' },
];

export interface DateRangeController {
  preset: DateRangePreset;
  customFrom: string;
  customTo: string;
  selectPreset: (p: DateRangePreset) => void;
  applyCustom: (from: string, to: string) => void;
}

/**
 * Estado compartido del filtro de tiempo (predefinido elegido + fechas
 * personalizadas), sin acoplar a un marcado concreto. Permite colocar el
 * selector y las fechas en posiciones distintas del layout (p. ej. que las
 * fechas de «Personalizado» caigan en una línea propia). Devuelve los
 * predefinidos anclados al mes CALENDARIO EN CURSO (no al último mes con
 * datos): "últimos 6 meses" siempre acaba en el mes actual aunque aún no haya
 * movimientos, para no desplazar la ventana al mes anterior.
 */
export function useDateRangeFilter(
  min: string,
  max: string,
  onChange: (range: DateRange | null) => void,
  defaultFrom?: string,
  defaultTo?: string,
): DateRangeController {
  const [preset, setPreset] = useState<DateRangePreset>('all');
  const [customFrom, setCustomFrom] = useState(dayOf(min));
  const [customTo, setCustomTo] = useState(lastDayOf(max));

  const selectPreset = (p: DateRangePreset) => {
    setPreset(p);
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
    setCustomFrom(from);
    setCustomTo(to);
    onChange({ from, to });
  };

  return { preset, customFrom, customTo, selectPreset, applyCustom };
}

export interface CustomRangeInputsProps {
  /** Fecha de inicio (YYYY-MM-DD). */
  from: string;
  /** Fecha de fin (YYYY-MM-DD). */
  to: string;
  /** Límite inferior para la fecha de inicio. */
  min: string;
  /** Límite superior para la fecha de fin (por defecto, hoy). */
  max?: string;
  /** Notifica el intervalo corregido (las fechas se mantienen coherentes). */
  onChange: (from: string, to: string) => void;
}

/** Par de selectores de fecha (inicio → fin) de «Personalizado». */
export function CustomRangeInputs({ from, to, min, max, onChange }: CustomRangeInputsProps) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <DateInput
        value={from}
        min={min}
        max={to}
        ariaLabel={t('dateFilter.fromAria')}
        onChange={value => {
          const nextTo = value > to ? value : to;
          onChange(value, nextTo);
        }}
      />
      <span className="text-sm text-gray-400">→</span>
      <DateInput
        value={to}
        min={from}
        max={max ?? todayISO()}
        ariaLabel={t('dateFilter.toAria')}
        onChange={value => {
          const nextFrom = value < from ? value : from;
          onChange(nextFrom, value);
        }}
      />
    </span>
  );
}

/** Selector de intervalo de fechas para las gráficas: predefinidos (último
 *  mes, 6 meses, año, todo) o un rango personalizado de meses. */
export function DateRangeFilter({ min, max, defaultFrom, defaultTo, onChange, className = '' }: DateRangeFilterProps) {
  const { t } = useI18n();
  const { preset, customFrom, customTo, selectPreset, applyCustom } = useDateRangeFilter(
    min,
    max,
    onChange,
    defaultFrom,
    defaultTo,
  );

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Select
        value={preset}
        onChange={v => selectPreset(v as DateRangePreset)}
        ariaLabel={t('dateFilter.aria')}
        className="w-44"
        options={PRESET_LABELS.map(o => ({ value: o.value, label: t(`dateFilter.${o.value}`) }))}
      />
      {preset === 'custom' && (
        <CustomRangeInputs
          from={customFrom}
          to={customTo}
          min={dayOf(defaultFrom ?? min)}
          onChange={applyCustom}
        />
      )}
    </div>
  );
}