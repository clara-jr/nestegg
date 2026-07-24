import React from 'react';

export function FormContainer({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); }}>
        {children}
      </form>
    </section>
  );
}
