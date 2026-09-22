import type { ReactNode } from 'react';
import { localeOf, useI18n } from '../../../lib/i18n';
import { formatCurrency } from '../../../lib/calculations';
import type { CategoryTotal } from '../../../lib/investments';
import { ExpenseCategoryIcon } from './CategoryIcon';

export function signedExpenseFormat(value: number, suffix = ''): ReactNode {
  if (value > 0) {
    return (
      <span className="text-red-600 font-semibold">
        -{formatCurrency(value)}
        {suffix}
      </span>
    );
  }
  if (value < 0) {
    return (
      <span className="text-emerald-600 font-semibold">
        +{formatCurrency(-value)}
        {suffix}
      </span>
    );
  }
  return (
    <span className="text-gray-500 font-semibold">
      {formatCurrency(0)}
      {suffix}
    </span>
  );
}

export function CategoryBreakdown({ categories, period }: { categories: CategoryTotal[]; period?: string }) {
  const { t, lang, tCategory } = useI18n();
  const sorted = categories
    .filter(c => c.total !== 0)
    .sort((a, b) => b.total - a.total);
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-8">
        {t('common.byCategory')}{period ? ` · ${period}` : ''}
      </h4>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center border border-gray-100 rounded-xl bg-[#fdfdfe]">
          {period ? t('common.noExpensesInPeriod') : t('common.noExpensesRecorded')}
        </p>
      ) : (
      <ul className="space-y-3">
        {sorted.map(c => {
          const isCredit = c.total < 0;
          const contributors = !isCredit && c.byMember
            ? c.byMember.filter(mb => mb.total > 0)
            : [];
          const contributorSum = contributors.reduce((s, mb) => s + mb.total, 0);
          return (
            <li key={c.category} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                <span className="flex items-center gap-2 font-medium text-gray-700 min-w-0 sm:mr-auto">
                  <ExpenseCategoryIcon category={c.category} size={16} />
                  {tCategory(c.category)}
                </span>
                <span className="text-gray-600 whitespace-nowrap w-full sm:w-auto">
                  {signedExpenseFormat(c.averageMonthly, t('common.perMonth'))}
                  <span className="text-gray-400 text-xs ml-1">{t('common.since', { date: new Date(`${c.firstDate}T00:00:00`).toLocaleDateString(localeOf(lang)) })}</span>
                </span>
                <span className="flex items-baseline gap-3 w-full sm:w-auto">
                  <span className="text-gray-600 font-medium whitespace-nowrap">{signedExpenseFormat(c.total)}</span>
                  <span className="text-gray-400 whitespace-nowrap">
                    {!isCredit && c.pct >= 0.05 ? `${c.pct.toFixed(1)}%` : ''}
                  </span>
                </span>
              </div>
              <div className="relative group">
                <div className="h-2 rounded-full bg-zinc-100 overflow-hidden flex">
                  {contributors.length > 0 ? (
                    contributors.map((mb, i) => (
                      <div
                        key={mb.profileId}
                        className={`h-full ${i === contributors.length - 1 ? 'rounded-r-full' : ''}`}
                        style={{
                          width: `${(contributorSum > 0 ? (mb.total / contributorSum) * Math.abs(c.pct) : 0)}%`,
                          backgroundColor: mb.color,
                        }}
                      />
                    ))
                  ) : (
                    <div
                      className={`h-full rounded-full ${isCredit ? 'bg-emerald-400/80' : 'bg-red-400/80'}`}
                      style={{ width: `${Math.max(1, Math.min(100, Math.abs(c.pct)))}%` }}
                    />
                  )}
                </div>
                {contributors.length > 0 && (
                  <div className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 hidden group-hover:block min-w-48 rounded-md bg-[#fdfdfe] px-3 py-2 text-xs text-gray-700 shadow-lg ring-1 ring-gray-200">
                    <p className="mb-1 font-semibold text-gray-500">{tCategory(c.category)}</p>
                    {contributors.map(mb => (
                      <div key={mb.profileId} className="flex items-center gap-2 py-0.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: mb.color }} />
                        <span className="font-medium">{mb.name}</span>
                        <span className="ml-auto font-semibold whitespace-nowrap">
                          -{formatCurrency(mb.averageMonthly)}{t('common.perMonth')}
                        </span>
                        <span className="text-gray-400 whitespace-nowrap">
                          ({c.total > 0 ? ((mb.total / c.total) * 100).toFixed(1) : '0.0'} %)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
}

export function LastMonthBreakdown({ categories }: { categories: CategoryTotal[] }) {
  const { t, tCategory } = useI18n();
  const rows = categories.filter(c => c.lastMonth !== 0);
  const total = rows.reduce((sum, c) => sum + c.lastMonth, 0);
  const gross = rows.reduce((sum, c) => sum + (c.lastMonth > 0 ? c.lastMonth : 0), 0);
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-8">
        {t('common.thisMonthByCategory')}
      </h4>
      <ul className="space-y-3">
        {rows.map(c => {
          const pct = c.lastMonth > 0 && gross > 0 ? (c.lastMonth / gross) * 100 : undefined;
          return (
            <li key={c.category} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium text-gray-700">
                <ExpenseCategoryIcon category={c.category} size={16} />
                {tCategory(c.category)}
              </span>
              <span className="text-gray-600">
                {signedExpenseFormat(c.lastMonth)}
                {pct !== undefined && (
                  <span className="text-gray-400 ml-2">{pct >= 0.05 ? `${pct.toFixed(1)}%` : '<0.1%'}</span>
                )}
              </span>
            </li>
          );
        })}
        <li className="flex items-center justify-between text-sm border-t border-gray-200 pt-2">
          <span className="font-semibold text-gray-700">{t('common.totalThisMonth')}</span>
          {signedExpenseFormat(total)}
        </li>
      </ul>
    </div>
  );
}

export function LastYearBreakdown({ avgByCategory }: { avgByCategory: Record<string, number> }) {
  const { t, tCategory } = useI18n();
  const sorted = Object.entries(avgByCategory)
    .filter(([, avg]) => avg !== 0)
    .sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  const total = sorted.reduce((sum, [, avg]) => sum + avg, 0);
  const gross = sorted.reduce((sum, [, avg]) => sum + (avg > 0 ? avg : 0), 0);
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-8">
        {t('common.lastYearByCategory')}
      </h4>
      <ul className="space-y-3">
        {sorted.map(([category, avg]) => {
          const pct = avg > 0 && gross > 0 ? (avg / gross) * 100 : undefined;
          return (
            <li key={category} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium text-gray-700">
                <ExpenseCategoryIcon category={category} size={16} />
                {tCategory(category)}
              </span>
              <span className="text-gray-600 min-w-[9.25rem] text-right">
                {signedExpenseFormat(avg, t('common.perMonth'))}
                {pct !== undefined && (
                  <span className="text-gray-400 ml-2">{pct >= 0.05 ? `${pct.toFixed(1)}%` : '<0.1%'}</span>
                )}
              </span>
            </li>
          );
        })}
        <li className="flex items-center justify-between text-sm border-t border-gray-200 pt-2">
          <span className="font-semibold text-gray-700">{t('common.lastYearTotal')}</span>
          {signedExpenseFormat(total, t('common.perMonth'))}
        </li>
      </ul>
    </div>
  );
}