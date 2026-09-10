import React from 'react';

export function FormContainer({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-[#fdfdfe] border border-gray-200 rounded-2xl p-6 sm:p-8">
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); }}>
        {children}
      </form>
    </section>
  );
}
