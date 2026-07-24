import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tooltipRef.current) return;
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;

    const spaceAbove = triggerRect.top;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const showAbove = spaceAbove >= spaceBelow;

    const top = showAbove
      ? triggerRect.top - tooltipHeight - 8
      : triggerRect.bottom + 8;

    let left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8));

    setPos({ top, left });
  }, [open]);

  return (
    <span
      ref={triggerRef}
      onClick={() => setOpen(!open)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className="relative inline-flex items-center cursor-pointer"
    >
      {children}
      {open && (
        <span
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
          }}
          className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs leading-tight whitespace-normal max-w-[min(36rem,calc(100vw-2rem))] break-words shadow-lg z-50 pointer-events-none normal-case tracking-normal font-normal text-left"
        >
          {text}
        </span>
      )}
    </span>
  );
}
