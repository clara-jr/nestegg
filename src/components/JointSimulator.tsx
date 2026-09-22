import React, { useEffect, useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatAxisCurrency, formatSigned } from '../lib/calculations';
import { useI18n, formatDayLocalized, type Lang } from '../lib/i18n';
import { EXPENSE_CATEGORY_LIST, DAY_FILTER, averageInRange, currentMonthKey, monthsBetween, rangeFromDay, rangeMonth, rangeToDay } from '../lib/investments';
import type { Movement } from '../lib/bankImports';
import { reclassifyPaypalDuplicates } from '../lib/bankImports';
import {
  DATA_CHANGED_EVENT,
  PROFILE_CHANGED_EVENT,
  getJointConfig,
  getProfileData,
  getProfiles,
  saveJointConfig,
} from '../lib/profiles';
import { averageMonthlyJointInRange, computeJointDailySeries, computeJointSummary, sumJointDailyRange, type JointSummary } from '../lib/joint';
import {
  CategoryBreakdown,
  ChartRangeSummary,
  ChartTooltip,
  CustomRangeInputs,
  PRESET_LABELS,
  dayOf,
  useDateRangeFilter,
  type DateRange,
  type DateRangePreset,
  ExpenseCategoryIcon,
  IncomeExpenseTooltip,
  LastMonthBreakdown,
  LastYearBreakdown,
  ScrollableTable,
  Select,
  SignedTooltipLine,
  SummaryCard,
  Icon,
} from './common';

interface InvestmentsStore {
  files: unknown[];
  movements: Movement[];
}

function loadMovements(profileId: string): Movement[] {
  const raw = getProfileData(profileId, 'nestegg-investments-v1');
  const movements =
    raw && typeof raw === 'object' && !Array.isArray(raw) && 'movements' in raw
      ? (raw as InvestmentsStore).movements ?? []
      : [];
  return reclassifyPaypalDuplicates(movements);
}

function fmtMonth(month: string, lang: Lang): string {
  return formatDayLocalized(lang, month, { month: 'short', year: '2-digit' });
}

function pct(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)} %`;
}

/** Valor compuesto de una card: ingresos, gastos y capacidad de ahorro. */
function IncomeExpenseValue({ income, expenses, savings, perMonth = false, t }: { income: number; expenses: number; savings: number; perMonth?: boolean; t: (key: string, vars?: Record<string, string | number>) => string }) {
  const suffix = perMonth ? t('affordability.perMonth') : '';
  return (
    <div className="w-full space-y-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.7rem] font-medium uppercase tracking-wide text-gray-400">{t('joint.income')}</span>
        <span className="text-sm text-emerald-600 font-bold whitespace-nowrap">{formatSigned(income)}{suffix}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.7rem] font-medium uppercase tracking-wide text-gray-400">{t('joint.expenses')}</span>
        <span className="text-sm text-red-600 font-bold whitespace-nowrap">{formatSigned(-expenses)}{suffix}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.7rem] font-medium uppercase tracking-wide text-gray-400">{t('joint.savings')}</span>
        <span className={`text-sm font-bold whitespace-nowrap ${savings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatSigned(savings)}{suffix}</span>
      </div>
    </div>
  );
}

/**
 * Sección interna del Agregador de Finanzas que agrega los ingresos y gastos
 * reales de todos los perfiles (integrantes) y evalúa cuánto aporta cada uno
 * a las categorías de gasto marcadas como «conjuntas».
 */
export default function JointSimulator() {
  const { t, tCategory, lang } = useI18n();
  const [tick, setTick] = useState(0);
  const [config, setConfig] = useState(() => getJointConfig());
  const [jointView, setJointView] = useState<string>('all');

  useEffect(() => {
    const refresh = () => setTick(t => t + 1);
    window.addEventListener(DATA_CHANGED_EVENT, refresh);
    window.addEventListener(PROFILE_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, refresh);
      window.removeEventListener(PROFILE_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const memberProfiles = useMemo(() => {
    const profiles = getProfiles();
    return profiles.map(p => ({
      profileId: p.id,
      name: p.name,
      color: p.color,
      movements: loadMovements(p.id),
    }));
  }, [tick]);

  const summary: JointSummary = useMemo(
    () => computeJointSummary(memberProfiles, config.jointCategories),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memberProfiles, config.jointCategories]
  );

  const toggleCategory = (category: string) => {
    setConfig(prev => {
      const next = {
        jointCategories: prev.jointCategories.includes(category)
          ? prev.jointCategories.filter(c => c !== category)
          : [...prev.jointCategories, category],
      };
      saveJointConfig(next);
      return next;
    });
  };

  const hasData = summary.monthly.length > 0 && summary.monthly.some(p => p.income !== 0 || p.expenses !== 0);

  // Eje mensual continuo: los meses sin movimientos (cifra 0) se muestran
  // igualmente en la gráfica rellenando el hueco entre el primer mes con datos
  // y el mes en curso (incluido), para que el mes actual aparezca aunque aún
  // no tenga movimientos.
  const monthAxis = useMemo(() => {
    const rows = summary.monthly;
    if (rows.length === 0) return [] as string[];
    return monthsBetween(rows[0].month, currentMonthKey());
  }, [summary.monthly]);

  const chartData = useMemo(() => {
    const byMonth = new Map(summary.monthly.map(p => [p.month, p]));
    return monthAxis.map(month => {
      const p = byMonth.get(month);
      return {
        month,
        label: fmtMonth(month, lang),
        income: p?.income ?? 0,
        expenses: p?.expenses ?? 0,
        savings: p?.savings ?? 0,
        savingsRate: p?.savingsRate ?? null,
      };
    });
  }, [monthAxis, summary.monthly, lang]);

  const isCategoryView =
    jointView.startsWith('cat:') && jointView.slice(4) in summary.monthlyByCategory;
  const selectedCategory = isCategoryView ? jointView.slice(4) : null;

  const chartView = isCategoryView ? jointView : jointView.startsWith('cat:') ? 'all' : jointView;

  const gastosCategories = useMemo(
    () => Object.keys(summary.monthlyByCategory).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    [summary.monthlyByCategory]
  );

  const categoryChartData = useMemo(() => {
    if (!selectedCategory) return [] as typeof chartData;
    const byMonth = new Map(
      (summary.monthlyByCategory[selectedCategory] ?? []).map(p => [p.month, p.total]),
    );
    const summaryByMonth = new Map(summary.monthly.map(p => [p.month, p]));
    return monthAxis.map(month => {
      const p = summaryByMonth.get(month);
      return {
        month,
        label: fmtMonth(month, lang),
        income: p?.income ?? 0,
        expenses: p?.expenses ?? 0,
        savings: p?.savings ?? 0,
        savingsRate: p?.savingsRate ?? null,
        total: byMonth.get(month) ?? 0,
      };
    }) as typeof chartData;
  }, [selectedCategory, monthAxis, summary.monthly, summary.monthlyByCategory, lang]);

  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const visibleChartData = useMemo(
    () =>
      dateRange
        ? chartData.filter(p => p.month >= rangeMonth(dateRange.from) && p.month <= rangeMonth(dateRange.to))
        : chartData,
    [chartData, dateRange]
  );
  const visibleCategoryChartData = useMemo(
    () =>
      dateRange
        ? categoryChartData.filter(p => p.month >= rangeMonth(dateRange.from) && p.month <= rangeMonth(dateRange.to))
        : categoryChartData,
    [categoryChartData, dateRange]
  );
  // Cuando el intervalo elegido no supera un mes, el eje pasa a ser diario:
  // se acumulan los movimientos de todos los integrantes por día (y de la
  // categoría seleccionada, si hay una), se recorta a los días del intervalo
  // y se rellenan los días sin actividad con 0.
  const isDaily = dateRange ? dateRange.from.slice(0, 7) === dateRange.to.slice(0, 7) : false;
  // La media del intervalo se calcula por días cuando el rango no supera un mes
  // o cuando el intervalo personalizado usa fechas con día (para que mover el
  // inicio dentro de un mes cambie el resultado; la media de un intervalo
  // personalizado con más de un mes se expresa «por mes», contando solo los
  // días exactos del intervalo.
  const perDay = isDaily;
  const dailyData = useMemo(() => {
    if (!isDaily || !dateRange) return [] as typeof chartData;
    const month = rangeMonth(dateRange.from);
    return computeJointDailySeries(memberProfiles, month, selectedCategory)
      .filter(p => p.date >= rangeFromDay(dateRange.from) && p.date <= rangeToDay(dateRange.to))
      .map(p => ({
        month: p.date,
        label: formatDayLocalized(lang, p.date, { day: '2-digit', month: 'short' }),
        income: p.income,
        expenses: p.expenses,
        savings: p.savings,
        savingsRate: p.income > 0 ? (p.savings / p.income) * 100 : null,
        total: p.expenses,
      }));
  }, [isDaily, dateRange, memberProfiles, selectedCategory, lang]);
  const chartDataFinal = isCategoryView
    ? isDaily
      ? dailyData
      : visibleCategoryChartData
    : isDaily
      ? dailyData
      : visibleChartData;

  // Límites del intervalo «Sin filtro de tiempo»: del primer mes con
  // movimientos al último mes ya terminado.
  const todoBounds = useMemo(() => {
    const completed = [...summary.monthly].map(p => p.month).filter(m => m < currentMonthKey()).sort();
    return { from: completed[0], to: completed[completed.length - 1] };
  }, [summary.monthly]);

  const chartTime = useDateRangeFilter(
    monthAxis[0] ?? '',
    monthAxis[monthAxis.length - 1] ?? '',
    setDateRange,
    todoBounds.from,
    todoBounds.to,
  );

  const intervalSummary = useMemo(() => {
    // En modo diario se usa la serie diaria del intervalo exacto, con 0 en los
    // días sin actividad. Con un intervalo personalizado por días de más de un
    // mes se cuentan solo los días exactos del intervalo pero la media se
    // expresa «por mes». Con meses (sin día o sin filtro) se usa la serie
    // mensual completa dentro del intervalo (no la ventana que la gráfica
    // muestra), para que las medias coincidan con las de las gráficas
    // individuales en las mismas condiciones. Sin filtro de tiempo no se cuenta
    // el mes en curso (aún incompleto); con un intervalo seleccionado sí se
    // incluye lo elegido.
    if (dateRange && isDaily) {
      const { days, income, expenses } = sumJointDailyRange(
        memberProfiles,
        rangeFromDay(dateRange.from),
        rangeToDay(dateRange.to),
        isCategoryView ? selectedCategory : null,
      );
      if (days <= 0) return null;
      return { income: income / days, expenses: expenses / days, savings: (income - expenses) / days };
    }
    if (dateRange && (DAY_FILTER.test(dateRange.from) || DAY_FILTER.test(dateRange.to))) {
      return averageMonthlyJointInRange(
        memberProfiles,
        rangeFromDay(dateRange.from),
        rangeToDay(dateRange.to),
        isCategoryView ? selectedCategory : null,
      );
    }
    const incomeSeries = summary.monthly.map(p => ({ month: p.month, total: p.income }));
    const expenseSeries =
      isCategoryView && selectedCategory
        ? summary.monthlyByCategory[selectedCategory] ?? []
        : summary.monthly.map(p => ({ month: p.month, total: p.expenses }));
    const from = dateRange ? rangeMonth(dateRange.from) : todoBounds.from;
    const to = dateRange ? rangeMonth(dateRange.to) : todoBounds.to;
    if (!from || !to || from > to) return null;
    const income = averageInRange(incomeSeries, from, to);
    const expenses = averageInRange(expenseSeries, from, to);
    return { income, expenses, savings: income - expenses };
  }, [isDaily, dateRange, memberProfiles, isCategoryView, selectedCategory, summary.monthly, summary.monthlyByCategory, todoBounds]);

  const renderJointTooltip = (payload: { payload?: Record<string, unknown> }[]) => {
    const p = payload[0]?.payload ?? {};
    const label = String(p?.label ?? '');
    if (jointView === 'income') {
      return (
        <>
          <p className="mb-1 font-semibold text-gray-900">{label}</p>
          <SignedTooltipLine label={t('joint.income')} value={Number(p?.income ?? 0)} />
        </>
      );
    }
    if (jointView === 'expenses') {
      return (
        <>
          <p className="mb-1 font-semibold text-gray-900">{label}</p>
          <SignedTooltipLine label={t('joint.expenses')} value={-Number(p?.expenses ?? 0)} />
        </>
      );
    }
    if (isCategoryView) {
      return (
        <>
          <p className="mb-1 font-semibold text-gray-900">{label}</p>
          <SignedTooltipLine label={tCategory(selectedCategory)} value={-Number(p?.total ?? 0)} />
        </>
      );
    }
    return (
      <IncomeExpenseTooltip
        label={label}
        income={Number(p?.income ?? 0)}
        expenses={Number(p?.expenses ?? 0)}
        savings={Number(p?.savings ?? 0)}
      />
    );
  };

  const memberJointFor = (memberIdx: number, month: string) =>
    summary.members[memberIdx]?.monthly.find(r => r.month === month);

  const totalJointFor = (month: string) =>
    summary.members.reduce((acc, m) => acc + (m.monthly.find(r => r.month === month)?.jointExpenses ?? 0), 0);

  return (
    <div className="space-y-4 pb-6">
        <h3 className="py-2 text-base font-bold text-gray-900 uppercase tracking-wider">{t('joint.title')}</h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          {t('joint.intro1')}<span className="font-semibold text-gray-700"> {t('joint.intro2')}</span>{' '}
          {t('joint.intro3')}
        </p>

      {hasData ? (
        <>
          <div className="grid grid-cols-1 min-[500px]:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
            <SummaryCard
              label={t('home.preview.avgMonthlyIncome')}
              value={formatSigned(summary.averageMonthlyIncome)}
              variant="info"
              subtitle={t('home.preview.median', { value: formatSigned(summary.medianMonthlyIncome), months: summary.incomeMonthCount })}
            />
            <SummaryCard
              label={t('home.preview.avgMonthlyExpense')}
              value={formatSigned(-summary.averageMonthlyExpenses)}
              variant="negative"
              subtitle={t('home.preview.median', { value: formatSigned(-summary.medianMonthlyExpenses), months: summary.expenseMonthCount })}
            />
            <SummaryCard
              label={t('joint.avgSavingsCapacity')}
              value={formatSigned(summary.averageMonthlySavings)}
              variant={summary.averageMonthlySavings >= 0 ? 'positive' : 'negative'}
              subtitle={t('home.preview.median', { value: formatSigned(summary.medianMonthlySavings), months: summary.savingsMonthCount })}
            />
            <SummaryCard
              label={t('joint.averageLastYear')}
              value={
                <IncomeExpenseValue
                  income={summary.lastYearAvgIncome}
                  expenses={summary.lastYearAvgExpenses}
                  savings={summary.lastYearAvgSavings}
                  perMonth
                  t={t}
                />
              }
              variant="neutral"
            />
            <SummaryCard
              label={t('joint.currentMonth')}
              value={
                <IncomeExpenseValue
                  income={summary.currentMonthIncome}
                  expenses={summary.currentMonthExpenses}
                  savings={summary.currentMonthIncome - summary.currentMonthExpenses}
                  t={t}
                />
              }
              variant="neutral"
            />
            <SummaryCard
              label={t('joint.previousMonth')}
              value={
                <IncomeExpenseValue
                  income={summary.previousMonthIncome}
                  expenses={summary.previousMonthExpenses}
                  savings={summary.previousMonthIncome - summary.previousMonthExpenses}
                  t={t}
                />
              }
              variant="neutral"
            />
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 mb-3 mt-8">
              <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                {t('joint.chartTitle')}
              </h4>
              <div className="flex-1" />
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={chartView}
                  onChange={setJointView}
                  ariaLabel={t('joint.chartCategoryAria')}
                  className="w-52"
                  options={[
                    { value: 'all', label: t('joint.all') },
                    { value: 'income', label: t('joint.income') },
                    ...(gastosCategories.length > 1 ? [] : [{ value: 'expenses', label: t('joint.expenses') }]),
                  ]}
                  groups={
                    gastosCategories.length > 1
                      ? [{
                          label: t('joint.expenses'),
                          options: [
                            { value: 'expenses', label: t('joint.allExpenses') },
                            ...gastosCategories.map(cat => ({
                              value: `cat:${cat}`,
                              label: tCategory(cat),
                              icon: <ExpenseCategoryIcon category={cat} size={12} />,
                            })),
                          ],
                        }]
                      : undefined
                  }
                />
                <Select
                  value={chartTime.preset}
                  onChange={v => chartTime.selectPreset(v as DateRangePreset)}
                  ariaLabel={t('dateFilter.aria')}
                  className="w-44"
                  options={PRESET_LABELS.map(o => ({ value: o.value, label: t(`dateFilter.${o.value}`) }))}
                />
              </div>
              {chartTime.preset === 'custom' && (
                <CustomRangeInputs
                  from={chartTime.customFrom}
                  to={chartTime.customTo}
                  min={dayOf(todoBounds.from ?? monthAxis[0] ?? '')}
                  onChange={chartTime.applyCustom}
                />
              )}
            </div>
            <div className="relative">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartDataFinal} margin={{ top: 5, right: 10, left: 4, bottom: 5 }}>
                <CartesianGrid stroke="#ececea" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9b9a95' }} interval={isDaily ? 2 : 'preserveStartEnd'} />
                <YAxis tick={{ fontSize: 11, fill: '#9b9a95' }} width={54} tickFormatter={v => formatAxisCurrency(v)} />
                <RechartsTooltip
                  wrapperStyle={{ zIndex: 20 }}
                  content={
                    <ChartTooltip renderContent={renderJointTooltip} />
                  }
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                {jointView === 'all' && (
                  <>
                    <Bar dataKey="income" name={t('joint.income')} fill="#00bc7d" radius={[3, 3, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="expenses" name={t('joint.expenses')} fill="#ff637e" radius={[3, 3, 0, 0]} maxBarSize={40} />
                    {!isDaily && <Line dataKey="savings" name={t('joint.savings')} stroke="#464541" type="monotone" strokeWidth={2} dot={false} />}
                  </>
                )}
                {jointView === 'income' && (
                  <Bar dataKey="income" name={t('joint.income')} fill="#00bc7d" radius={[3, 3, 0, 0]} maxBarSize={40} />
                )}
                {jointView === 'expenses' && (
                  <Bar dataKey="expenses" name={t('joint.expenses')} fill="#ff637e" radius={[3, 3, 0, 0]} maxBarSize={40} />
                )}
                {isCategoryView && selectedCategory && (
                  <Bar dataKey="total" name={tCategory(selectedCategory)} fill="#ff637e" radius={[3, 3, 0, 0]} maxBarSize={40} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            {/* La caja de medias solo se muestra con un intervalo explicitamente elegido */}
            {dateRange && intervalSummary && (
              <ChartRangeSummary
                income={intervalSummary.income}
                expenses={intervalSummary.expenses}
                savings={intervalSummary.savings}
                perDay={perDay}
                categoryOnly={isCategoryView}
                categoryLabel={isCategoryView ? tCategory(selectedCategory) ?? undefined : undefined}
              />
            )}
          </div>
          </div>

          {/*<div>
            <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-8">
              Capacidad de ahorro por mes
            </h4>
            <ScrollableTable
              columns={[
                { title: 'Mes', align: 'left' },
                { title: 'Ingresos', align: 'right' },
                { title: 'Gastos', align: 'right' },
                { title: 'Ahorro', align: 'right' },
                { title: 'Tasa de Ahorro', align: 'right', muted: true },
              ]}
              rows={summary.monthly.map(p => [
                { content: fmtMonth(p.month), className: 'text-gray-500' },
                { content: formatSigned(p.income), className: 'font-semibold text-emerald-600' },
                { content: formatSigned(-p.expenses), className: 'font-semibold text-red-600' },
                {
                  content: (
                    <span className={`font-semibold ${p.savings >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                      {formatSigned(p.savings)}
                    </span>
                  ),
                },
                { content: pct(p.savingsRate, 1), className: 'text-gray-500' },
              ])}
            />
          </div>*/}
        </>
      ) : (
        <div className="py-14 flex flex-col items-center justify-center text-center gap-3">
          <Icon name="home" className="h-14 w-14 text-gray-400" />
          <p className="text-base font-bold text-gray-900">{t('joint.emptyTitle')}</p>
          <p className="text-sm text-gray-500 max-w-md leading-relaxed">
            {t('joint.empty1')}{' '}<span className="font-semibold text-gray-700">{t('joint.empty2')}</span>
            {t('joint.empty3')}
          </p>
        </div>
      )}

      {hasData && (
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-3 mt-8">
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{t('joint.jointCategoriesTitle')}</h4>
          <span className="text-xs font-semibold text-gray-500">{t('joint.categoriesSelected', { n: config.jointCategories.length })}</span>
        </div>
          {config.jointCategories.length === 0 && (
            <p className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed mt-1">
              <Icon name="warning" className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{t('joint.noJointCategories')}</span>
            </p>
          )}
          <div className="grid grid-cols-1 min-[413px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-3">
            {EXPENSE_CATEGORY_LIST.map(category => {
              const checked = config.jointCategories.includes(category);
              return (
                <label
                  key={category}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer transition-colors ${
                    checked
                      ? 'bg-zinc-100 border-gray-300 text-gray-900'
                      : 'bg-[#fdfdfe] border-gray-200 text-gray-700 hover:bg-zinc-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCategory(category)}
                    className="w-4 h-4 accent-gray-700 cursor-pointer"
                  />
                  <ExpenseCategoryIcon category={category} size={12} />
                  <span className="font-medium">{tCategory(category)}</span>
                </label>
              );
            })}
          </div>
      </div>
      )}

      {hasData && (config.jointCategories.length > 0 || summary.categoryBreakdown.length > 0) && (
      <div>
        <CategoryBreakdown categories={summary.categoryBreakdown} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0">
          <LastYearBreakdown avgByCategory={summary.last12ByCategory} />
          <LastMonthBreakdown categories={summary.categoryBreakdown} />
        </div>
        {summary.jointTotal > 0 && (
          <div className="flex items-center justify-between mb-3 mt-8">
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{t('joint.contributionTitle')}</h4>
          {/*summary.jointAverageMonthly > 0 && (
            <span className="text-xs font-semibold text-gray-500">
              Gasto conjunto medio/mes: {formatCurrency(summary.jointAverageMonthly)}
            </span>
          )*/}
        </div>
        )}
        <div className="mt-3 space-y-5">
          {summary.jointTotal === 0 ? (
            <p className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed">
              <Icon name="warning" className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{t('joint.noJointExpenses')}</span>
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
                {summary.members.map(member => (
                  <article key={member.profileId} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: member.color }} />
                      <p className="text-sm font-bold text-gray-900">{member.name}</p>
                    </div>
                    <dl className="space-y-1.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-gray-500">{t('joint.memberTotal')}</dt>
                        <dd className="font-semibold text-gray-900">{formatSigned(-member.totalJoint)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-1.5">
                        <dt className="text-gray-500">{t('joint.memberPctTotal')}</dt>
                        <dd className="font-semibold text-gray-900">{pct(member.totalPct, 1)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-gray-500">{t('joint.memberMonthlyAverage')}</dt>
                        <dd className="font-semibold text-gray-900">{formatSigned(-member.averageMonthlyJoint)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-gray-500">{t('joint.effort')}</dt>
                        <dd className="font-semibold text-gray-900">{pct(member.averagePctOfIncome, 1)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              <div>
                <ScrollableTable
                  columns={[
                    { title: t('joint.month'), align: 'left', minWidth: 114 },
                    ...summary.members.map(m => ({ title: m.name, align: 'right' as const, minWidth: 104 })),
                    { title: t('joint.householdTotal'), align: 'right', minWidth: 104 },
                  ]}
                  rows={[...summary.monthly].reverse().map(month => [
                      { content: fmtMonth(month.month, lang), className: 'text-gray-500' },
                      ...summary.members.map((member, mi) => {
                        const row = memberJointFor(mi, month.month);
                        return {
                          content: (
                            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                              <span className="text-gray-900">{formatSigned(-(row?.jointExpenses ?? 0))}</span>
                              <span className={`text-xs font-semibold ${(row?.pct ?? 0) >= 50 ? 'text-gray-900' : 'text-gray-400'}`}>
                                {pct(row?.pct ?? null, 0)}
                              </span>
                            </div>
                          ),
                        };
                      }),
                      {
                        content: (
                          <span className="font-semibold text-gray-900">{formatSigned(-totalJointFor(month.month))}</span>
                        ),
                      },
                    ])}
                />
                <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                  {t('joint.tableFootnote')}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}