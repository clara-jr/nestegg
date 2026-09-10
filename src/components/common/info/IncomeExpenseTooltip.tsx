import React from 'react';
import { formatSigned } from '../../../lib/calculations';

export interface IncomeExpenseTooltipProps {
  label?: string;
  /** Ingresos del mes (normalmente positivos). */
  income: number;
  /** Neto de gastos: positivo = se gastó más de lo devuelto; negativo = las devoluciones superan a los gastos. */
  expenses: number;
  /** Capacidad de ahorro: ingresos − gastos. */
  savings: number;
  /** Color de la línea de ahorro: 'auto' lo pinta según su signo; 'dark' lo
   *  deja en gris oscuro (para tooltips que acompañan a una línea gris). */
  savingsColor?: 'auto' | 'dark';
}

/** Línea de tooltip con cuantía coloreada según su signo: verde para
 *  positivos, rojo para negativos y gris sin signo para el valor 0. */
export function SignedTooltipLine({ label, value }: { label: string; value: number }) {
  const color = value === 0 ? 'text-gray-400' : value > 0 ? 'text-emerald-600' : 'text-red-600';
  return (
    <p className={color}>
      {label}: {formatSigned(value === 0 ? 0 : value)}
    </p>
  );
}

/** Contenido compartido del hover de las gráficas: ingresos en verde, gastos
 *  en rojo (verde si las devoluciones los convierten en crédito) y capacidad
 *  de ahorro coloreada según su signo. El valor 0 se muestra en gris, sin
 *  signo. */
export function IncomeExpenseTooltip({ label, income, expenses, savings, savingsColor = 'auto' }: IncomeExpenseTooltipProps) {
  return (
    <>
      {label && <p className="font-semibold text-gray-900">{label}</p>}
      <SignedTooltipLine label="Ingresos" value={income} />
      <SignedTooltipLine label="Gastos" value={-expenses} />
      {savingsColor === 'dark' ? (
        <p className="text-gray-900">
          Capacidad de ahorro: {formatSigned(savings)}
        </p>
      ) : (
        <SignedTooltipLine label="Capacidad de ahorro" value={savings} />
      )}
    </>
  );
}