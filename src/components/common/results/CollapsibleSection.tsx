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
        className="py-5 w-full px-6 sm:px-8 grid items-center gap-x-3 gap-y-3 grid-cols-[1fr_auto] min-[516px]:grid-cols-[auto_1fr_auto] min-[516px]:gap-y-0 cursor-pointer text-left"
      >
        <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider col-start-1 row-start-1">{title}</h3>
        <div className={`col-start-1 row-start-2 justify-self-start min-[516px]:col-start-2 min-[516px]:row-start-1 min-[516px]:justify-self-end ${headerRight ? '' : 'hidden'}`}>
          {headerRight}
        </div>
        <div className={`flex items-center justify-center justify-self-end self-center col-start-2 row-start-1 ${headerRight ? 'row-span-2' : 'row-span-1'} min-[516px]:col-start-3 min-[516px]:row-start-1 min-[516px]:row-span-1`}>
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 transition-colors">
            <svg className={`w-4 h-4 text-gray-600 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </span>
        </div>
      </button>
      {isOpen && children}
    </section>
  );
}
