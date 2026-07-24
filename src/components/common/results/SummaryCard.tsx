import React from 'react';

export interface SummaryCardProps {
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  variant?: 'positive' | 'negative' | 'neutral' | 'info';
  className?: string;
}

const variantStyles = {
  positive: {
    container: 'bg-emerald-50 border-emerald-200',
    label: 'text-emerald-800',
    value: 'text-emerald-700',
    subtitle: 'text-emerald-600',
  },
  negative: {
    container: 'bg-red-50 border-red-200',
    label: 'text-red-800',
    value: 'text-red-700',
    subtitle: 'text-red-600',
  },
  neutral: {
    container: 'bg-gray-50 border-gray-200',
    label: 'text-gray-600',
    value: 'text-gray-500',
    subtitle: 'text-gray-500',
  },
  info: {
    container: 'bg-gray-50 border-gray-200',
    label: 'text-gray-600',
    value: 'text-gray-900',
    subtitle: 'text-gray-500',
  },
} as const;

export function SummaryCard({ label, value, subtitle, variant = 'neutral', className }: Readonly<SummaryCardProps>) {
  const styles = variantStyles[variant];

  return (
    <article className={`rounded-lg px-4 py-3 border flex flex-col justify-center ${styles.container}${className ? ` ${className}` : ''}`}>
      <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${styles.label}`}>{label}</p>
      <p className={`text-lg font-bold ${styles.value}`}>{value}</p>
      {subtitle && <p className={`text-xs mt-1 ${styles.subtitle}`}>{subtitle}</p>}
    </article>
  );
}
