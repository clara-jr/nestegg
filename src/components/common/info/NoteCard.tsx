import React from 'react';

export interface NoteCardProps {
  children: React.ReactNode;
  variant?: 'info' | 'warning';
}

export function NoteCard({ children, variant = 'warning' }: Readonly<NoteCardProps>) {
  const colors = variant === 'warning'
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-blue-50 border-blue-200 text-blue-800';

  return (
    <div className={`mb-8 rounded-lg border px-4 py-3 ${colors}`}>
      <p className="text-xs leading-relaxed">{children}</p>
    </div>
  );
}
