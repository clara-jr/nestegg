import React, { useLayoutEffect, useRef, useState } from 'react';

export interface ScrollableTableColumn {
  title: React.ReactNode;
  align?: 'left' | 'right';
  muted?: boolean;
  className?: string;
  minWidth?: number;
}

export interface ScrollableTableCell {
  content: React.ReactNode;
  className?: string;
}

export type ScrollableTableRow = Array<React.ReactNode | ScrollableTableCell>;

export interface ScrollableTableProps {
  columns: ScrollableTableColumn[];
  rows: ScrollableTableRow[];
  bordered?: boolean;
}

function isCellObject(cell: React.ReactNode | ScrollableTableCell): cell is ScrollableTableCell {
  return cell !== null && typeof cell === 'object' && !Array.isArray(cell) && 'content' in cell;
}

function getCellContent(cell: React.ReactNode | ScrollableTableCell): React.ReactNode {
  return isCellObject(cell) ? cell.content : cell;
}

function getCellClassName(cell: React.ReactNode | ScrollableTableCell): string | undefined {
  return isCellObject(cell) ? cell.className : undefined;
}

export function ScrollableTable({ columns, rows, bordered = true }: Readonly<ScrollableTableProps>) {
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const bodyTableRef = useRef<HTMLTableElement>(null);
  const [colWidths, setColWidths] = useState<number[]>([]);

  const measure = () => {
    const headerScroll = headerScrollRef.current;
    const bodyTable = bodyTableRef.current;
    if (!headerScroll || !bodyTable) return;
    const firstRow = bodyTable.rows[0];
    if (!firstRow) return;
    const widths = Array.from(firstRow.cells).map((cell, i) =>
      Math.round(Math.max(cell.getBoundingClientRect().width, columns[i]?.minWidth ?? 0)),
    );
    setColWidths((prev) => {
      if (prev.length === widths.length && prev.every((w, i) => Math.abs(w - widths[i]) < 0.5)) return prev;
      return widths;
    });
    const headerTable = headerScroll.querySelector('table');
    if (headerTable) {
      headerTable.style.width = `${bodyTable.getBoundingClientRect().width}px`;
    }
  };

  useLayoutEffect(() => {
    measure();
  }, [rows]);

  useLayoutEffect(() => {
    const el = bodyScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [rows]);

  const syncHeaderScroll = () => {
    const body = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (body && header) header.scrollLeft = body.scrollLeft;
  };

  return (
    <div
      className={`relative overflow-hidden bg-[#fdfdfe] ${
        bordered ? 'rounded-xl border border-[#e3e3e0]/70' : ''
      }`}
    >
      <div ref={headerScrollRef} className="overflow-hidden">
        <table
          className="w-full min-w-full"
          style={{ tableLayout: 'fixed' }}
        >
          <colgroup>
            {columns.map((col, i) => (
              <col key={i} style={colWidths[i] ? { width: `${colWidths[i]}px` } : undefined} />
            ))}
          </colgroup>
          <thead className="bg-[#fdfdfe]">
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  style={col.minWidth ? { minWidth: `${col.minWidth}px` } : undefined}
                  className={`px-6 sm:px-8 py-3 text-xs font-bold uppercase tracking-wider bg-[#fdfdfe] border-b border-gray-200 ${
                    col.align === 'left' ? 'text-left' : 'text-right'
                  } ${col.muted ? 'text-gray-500' : 'text-gray-900'} ${col.className ?? ''}`}
                >
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      <div
        ref={bodyScrollRef}
        onScroll={syncHeaderScroll}
        className="custom-scroll overflow-x-auto overflow-y-auto max-h-[420px] overscroll-contain"
      >
        <table ref={bodyTableRef} className="w-full min-w-full mb-3">
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-zinc-100 transition-colors">
                {row.map((cell, ci) => {
                  const col = columns[ci];
                  return (
                    <td
                      key={ci}
                      style={col.minWidth ? { minWidth: `${col.minWidth}px` } : undefined}
                      className={`px-6 sm:px-8 py-2.5 text-sm ${
                        col.align === 'left' ? 'text-left' : 'text-right'
                      } ${getCellClassName(cell) ?? (col.muted ? 'text-gray-500' : 'text-gray-700')}`}
                    >
                      {getCellContent(cell)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}