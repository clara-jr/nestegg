import React from 'react';

export interface NoteBannerProps {
  children: React.ReactNode;
  variant?: 'info' | 'warning';
}

export function NoteBanner({ children, variant = 'info' }: Readonly<NoteBannerProps>) {
  const colors = variant === 'warning'
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-blue-50 border-blue-200 text-blue-800';

  return (
    <div className={`px-6 sm:px-8 py-3 border-t ${colors}`}>
      <p className="text-xs leading-relaxed">{children}</p>
    </div>
  );
}
