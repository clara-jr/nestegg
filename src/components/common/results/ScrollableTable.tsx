import React from 'react';

export interface ScrollableTableColumn {
  title: string;
  align?: 'left' | 'right';
  muted?: boolean;
}

export interface ScrollableTableCell {
  content: React.ReactNode;
  className?: string;
}

export type ScrollableTableRow = Array<React.ReactNode | ScrollableTableCell>;

export interface ScrollableTableProps {
  columns: ScrollableTableColumn[];
  rows: ScrollableTableRow[];
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

export function ScrollableTable({ columns, rows }: Readonly<ScrollableTableProps>) {
  return (
    <div className="relative">
      <div className="overflow-x-auto overflow-y-auto max-h-[420px] overscroll-contain">
        <table className="w-full min-w-full mb-3">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={`px-6 sm:px-8 py-3 text-xs font-bold uppercase tracking-wider sticky top-0 bg-gray-50 z-10 ${
                    col.align === 'left' ? 'text-left' : 'text-right'
                  } ${col.muted ? 'text-gray-500' : 'text-gray-900'}`}
                >
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-gray-50 transition-colors">
                {row.map((cell, ci) => {
                  const col = columns[ci];
                  return (
                    <td
                      key={ci}
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
      <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white from-50% to-transparent pointer-events-none" />
    </div>
  );
}
