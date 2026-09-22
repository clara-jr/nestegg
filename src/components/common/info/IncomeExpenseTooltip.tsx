import React from 'react';
import { useI18n } from '../../../lib/i18n';
import { formatSigned } from '../../../lib/calculations';

export interface IncomeExpenseTooltipProps {
  label?: string;
  /** Ingresos del mes (normalmente positivos). */
  income: number;
  /** Neto de gastos: positivo = se gastó más de lo devuelto; negativo = las devoluciones superan a los gastos. */
  expenses: number;
  /** Capacidad de ahorro: ingresos − gastos. */
  savings: number;
}

/** Línea de tooltip con cuantía coloreada según su signo: verde para
 *  positivos, rojo para negativos y gris sin signo para el valor 0. */
export function SignedTooltipLine({ label, value }: { label: string; value: number }) {
  const color = Math.abs(value) < 0.005 ? 'text-gray-500' : value > 0 ? 'text-emerald-600' : 'text-red-600';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold whitespace-nowrap ${color}`}>
        {formatSigned(Math.abs(value) < 0.005 ? 0 : value)}
      </span>
    </div>
  );
}

/** Contenido compartido del hover de las gráficas: ingresos en verde, gastos
 *  en rojo (verde si las devoluciones los convierten en crédito) y capacidad
 *  de ahorro coloreada según su signo. El valor 0 se muestra en gris, sin
 *  signo. */
export function IncomeExpenseTooltip({ label, income, expenses, savings }: IncomeExpenseTooltipProps) {
  const { t } = useI18n();
  return (
    <>
      {label && <p className="mb-1 font-semibold text-gray-900">{label}</p>}
      <SignedTooltipLine label={t('common.income')} value={income} />
      <SignedTooltipLine label={t('common.expenses')} value={-expenses} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-gray-500">{t('common.savings')}</span>
        <span className={`font-semibold whitespace-nowrap ${Math.abs(savings) < 0.005 ? 'text-gray-500' : 'text-gray-900'}`}>
          {formatSigned(Math.abs(savings) < 0.005 ? 0 : savings)}
        </span>
      </div>
    </>
  );
}