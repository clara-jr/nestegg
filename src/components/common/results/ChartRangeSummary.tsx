import { useI18n } from '../../../lib/i18n';
import { formatSigned } from '../../../lib/calculations';

const isZero = (v: number) => Math.abs(v) < 0.005;

function ZeroValue({ suffix }: { suffix: string }) {
  return (
    <span className="font-semibold text-gray-500">
      {formatSigned(0)}
      {suffix}
    </span>
  );
}

export interface ChartRangeSummaryProps {
  /** Media de ingresos por unidad del intervalo. */
  income: number;
  /** Media de gastos por unidad del intervalo. */
  expenses: number;
  /** Capacidad de ahorro media (ingresos − gastos). */
  savings: number;
  /** true si la gráfica está en modo diario (media «por día»); false si es mensual. */
  perDay: boolean;
  /** true (vista de categoría): solo se muestra la media de gastos de esa
   *  categoría, sin ingresos ni ahorro. */
  categoryOnly?: boolean;
  /** Nombre de la categoría seleccionada (se muestra en lugar de «Gastos»). */
  categoryLabel?: string;
}

/** Resumen flotante situado arriba a la derecha de una gráfica con las medias
 *  de ingresos, gastos y capacidad de ahorro del intervalo seleccionado. */
export function ChartRangeSummary({ income, expenses, savings, perDay, categoryOnly = false, categoryLabel }: ChartRangeSummaryProps) {
  const { t } = useI18n();
  const suffix = perDay ? t('common.perDay') : t('common.perMonth');

  if (categoryOnly) {
    return (
<div className="absolute right-0 top-0 z-10 rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          {t('common.rangeAverage')}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-gray-500">{categoryLabel || t('common.expenses')}</span>
          {isZero(expenses) ? (
            <ZeroValue suffix={suffix} />
          ) : (
            <span className={`font-semibold ${expenses < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatSigned(-expenses)}
              {suffix}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-0 z-10 rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {t('common.rangeAverage')}
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-gray-500">{t('common.income')}</span>
        {isZero(income) ? (
          <ZeroValue suffix={suffix} />
        ) : (
          <span className="font-semibold text-emerald-600">
            {formatSigned(income)}
            {suffix}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-gray-500">{t('common.expenses')}</span>
        {isZero(expenses) ? (
          <ZeroValue suffix={suffix} />
        ) : (
          <span className={`font-semibold ${expenses < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {formatSigned(-expenses)}
            {suffix}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-gray-500">{t('common.savings')}</span>
        {isZero(savings) ? (
          <ZeroValue suffix={suffix} />
        ) : (
          <span className="font-semibold text-gray-900">
            {formatSigned(savings)}
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}