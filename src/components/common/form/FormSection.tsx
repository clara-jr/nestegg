import React from 'react';

export interface FormSectionProps {
  title: string;
  children: React.ReactNode;
  cols?: 'single' | 'double' | 'triple';
}

export function FormSection({ title, children, cols = 'single' }: Readonly<FormSectionProps>) {
  const colsClass = {
    single: 'grid-cols-1',
    double: 'grid-cols-1 md:grid-cols-2',
    triple: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  }[cols];

  return (
    <section className="space-y-3 -mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200 pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider">{title}</h3>
      <div className={`grid ${colsClass} gap-3`}>{children}</div>
    </section>
  );
}
