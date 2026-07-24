import React from 'react';

export interface CollapsibleFormSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function CollapsibleFormSection({ title, isOpen, onToggle, children }: Readonly<CollapsibleFormSectionProps>) {
  return (
    <section className="-mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200 pt-5 space-y-5">
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-2 w-full text-left font-['Signika',_sans-serif]`}
      >
        <span className="text-base font-bold text-gray-900 uppercase tracking-wider">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && children}
    </section>
  );
}
