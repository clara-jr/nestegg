import React from 'react';

export interface CollapsibleSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, isOpen, onToggle, headerRight, children }: Readonly<CollapsibleSectionProps>) {
  return (
    <section className="-mx-6 sm:-mx-8 border-t border-gray-200 first:border-t-0 first:pt-0">
      <button
        onClick={onToggle}
        className="py-5 w-full px-6 sm:px-8 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
      >
        <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider">{title}</h3>
        <div className="flex items-center gap-3">
          {headerRight}
          <svg className={`cursor-pointer w-4 h-4 text-gray-600 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </button>
      {isOpen && children}
    </section>
  );
}
