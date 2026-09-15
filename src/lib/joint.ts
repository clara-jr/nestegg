import type { Movement } from './bankImports';
import {
  DAYS_PER_MONTH,
  EXCLUDED_CATEGORY,
  computeDailySeries,
  computeExpenses,
  computeIncome,
  completedMonths,
  currentMonthKey,
  dayCount,
  daysOfMonth,
  expenseSplits,
  isExpenseSplitJoint,
  median,
  monthSpan,
  monthsBetween,
  rangeMonth,
  type CategoryMemberTotal,
  type CategoryTotal,
  type DailyPoint,
  type ExpensesSummary,
  type IncomeSummary,
  type MonthPoint,
} from './investments';

/**
 * Agregación conjunta del Agregador de Finanzas. Combina ingresos y gastos
 * reales de los perfiles (integrantes) y evalúa cuánto dedica cada uno a los
 * gastos marcados como «conjuntos», por mes y de media.
 *
 * La vista conjunta solo tiene sentido cuando ambos integrantes han importado
 * datos, así que la ventana de convivencia arranca en el primer mes en que los
 * dos perfiles con datos tienen movimientos. Si solo hay un perfil con datos
 * (o ninguno), el resumen se devuelve vacío para que la interfaz muestre un
 * aviso.
 */

export interface JointMemberProfile {
  profileId: string;
  name: string;
  color: string;
  movements: Movement[];
}

export interface JointMemberMonth {
  month: string;
  /** Gasto conjunto aportado por este miembro en el mes. */
  jointExpenses: number;
  /** % de los gastos conjuntos del hogar cubiertos por este miembro. */
  pct: number | null;
  /** Gasto conjunto como % de los ingresos propios del miembro ese mes. */
  pctOfIncome: number | null;
}

export interface JointMemberResult {
  profileId: string;
  name: string;
  color: string;
  monthly: JointMemberMonth[];
  totalJoint: number;
  averageMonthlyJoint: number;
  /** % del gasto conjunto total del hogar cubierto por este miembro. */
  totalPct: number;
  /** Media mensual de gasto conjunto como % de sus propios ingresos. */
  averagePctOfIncome: number | null;
}

export interface JointMonthPoint {
  month: string;
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number | null;
}

export interface JointSummary {
  members: JointMemberResult[];
  monthly: JointMonthPoint[];
  totalIncome: number;
  totalExpenses: number;
  totalSavings: number;
  savingsRate: number | null;
  averageMonthlyIncome: number;
  averageMonthlyExpenses: number;
  averageMonthlySavings: number;
  averageSavingsRate: number | null;
  /** Nº de meses tenidos en cuenta para cada media mensual del hogar. */
  incomeMonthCount: number;
  expenseMonthCount: number;
  savingsMonthCount: number;
  /** Mediana mensual del hogar (meses terminados de la ventana de convivencia). */
  medianMonthlyIncome: number;
  medianMonthlyExpenses: number;
  medianMonthlySavings: number;
  /** Últimos 12 meses ya terminados: media de ingresos, gastos y ahorro. */
  lastYearAvgIncome: number;
  lastYearAvgExpenses: number;
  lastYearAvgSavings: number;
  jointTotal: number;
  jointAverageMonthly: number;
  currentMonthIncome: number;
  currentMonthExpenses: number;
  previousMonthIncome: number;
  previousMonthExpenses: number;
  /** Categorías conjuntas agregadas para el hogar (ventana de convivencia). */
  categoryBreakdown: CategoryTotal[];
  /** Media mensual por categoría conjunta en los últimos 12 meses calendario. */
  last12ByCategory: Record<string, number>;
  /** Serie mensual de cada categoría conjunta agregada para el hogar. */
  monthlyByCategory: Record<string, MonthPoint[]>;
}

interface MemberInput {
  profileId: string;
  name: string;
  color: string;
  income: IncomeSummary;
  expenses: ExpensesSummary;
  jointMonthly: Map<string, number>;
  /** Primer mes en que este perfil tiene cualquier movimiento. */
  firstMonth: string | null;
  /**
   * Mes a partir del cual el perfil registra ingreso Y gasto de forma continua:
   * el más reciente (limitante) entre el primer mes de su serie de ingresos y el
   * de su serie de gastos. Los meses con movimientos que no afectan a ingresos o
   * gastos (traspasos, etc.) no cuentan.
   */
  memberStart: string | null;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/** Fusiona los totales mensuales de cada integrante (mes → importe) en una
 *  única serie mensual ordenada, sumando los meses coincidentes. */
function mergeMonthly(maps: Iterable<Map<string, number>>): MonthPoint[] {
  const totals = new Map<string, number>();
  for (const map of maps) {
    for (const [month, total] of map) {
      totals.set(month, (totals.get(month) ?? 0) + total);
    }
  }
  return [...totals.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Serie diaria conjunta (todos los días del mes, rellenando con 0) a partir
 *  de los movimientos de cada integrante, con los mismos criterios que la
 *  serie mensual (ingresos type income, gastos expense/refund). Si se pasa
 *  `category`, solo cuenta el gasto de esa categoría. */
export function computeJointDailySeries(
  profiles: JointMemberProfile[],
  month: string,
  category: string | null = null,
): DailyPoint[] {
  const byDate = new Map(daysOfMonth(month).map(d => [d, { date: d, income: 0, expenses: 0, savings: 0 } as DailyPoint]));
  for (const p of profiles) {
    const daily = computeDailySeries(
      month,
      p.movements.filter(m => m.type === 'income'),
      p.movements.filter(m => m.type === 'expense' || m.type === 'refund'),
      category,
    );
    for (const row of daily) {
      const acc = byDate.get(row.date)!;
      acc.income += row.income;
      acc.expenses += row.expenses;
      acc.savings += row.savings;
    }
  }
  return [...byDate.values()];
}

/** Totales conjuntos de ingresos y gastos de un intervalo de días [from, to]
 *  usando las series diarias (los días sin movimientos cuentan con 0). */
export function sumJointDailyRange(
  profiles: JointMemberProfile[],
  from: string,
  to: string,
  category: string | null = null,
): { days: number; income: number; expenses: number } {
  let income = 0;
  let expenses = 0;
  for (const month of monthsBetween(rangeMonth(from), rangeMonth(to))) {
    for (const p of computeJointDailySeries(profiles, month, category)) {
      if (p.date >= from && p.date <= to) {
        income += p.income;
        expenses += p.expenses;
      }
    }
  }
  return { days: dayCount(from, to), income, expenses };
}

/** Medias por mes de un intervalo de días [from, to] de la serie conjunta
 *  (los días sin movimientos cuentan con 0). */
export function averageMonthlyJointInRange(
  profiles: JointMemberProfile[],
  from: string,
  to: string,
  category: string | null = null,
): { income: number; expenses: number; savings: number } {
  const { days, income, expenses } = sumJointDailyRange(profiles, from, to, category);
  const months = days / DAYS_PER_MONTH;
  return {
    income: months > 0 ? income / months : 0,
    expenses: months > 0 ? expenses / months : 0,
    savings: months > 0 ? (income - expenses) / months : 0,
  };
}

export function computeJointSummary(
  profiles: JointMemberProfile[],
  jointCategories: readonly string[],
): JointSummary {
  const signedAbs = (m: Movement, amount: number) => (m.type === 'refund' ? -1 : 1) * Math.abs(amount);

  const inputs: MemberInput[] = profiles.map(p => {
    const income = computeIncome(p.movements.filter(m => m.type === 'income'));
    const expenses = computeExpenses(p.movements.filter(m => m.type === 'expense' || m.type === 'refund'));
    const jointMonthly = new Map<string, number>();
    for (const m of p.movements) {
      if (m.type !== 'expense' && m.type !== 'refund') continue;
      for (const split of expenseSplits(m)) {
        if (split.category === EXCLUDED_CATEGORY || !isExpenseSplitJoint(m, split, jointCategories)) continue;
        const month = m.date.slice(0, 7);
        jointMonthly.set(month, (jointMonthly.get(month) ?? 0) + signedAbs(m, split.amount));
      }
    }
    const firstMonth = p.movements.length > 0
      ? p.movements.reduce((min, m) => (m.date.slice(0, 7) < min ? m.date.slice(0, 7) : min), p.movements[0].date.slice(0, 7))
      : null;
    const incomeStart = income.monthly.length > 0 ? income.monthly[0].month : null;
    const expenseStart = expenses.monthly.length > 0 ? expenses.monthly[0].month : null;
    const memberStart = [incomeStart, expenseStart]
      .filter((s): s is string => s !== null)
      .sort()
      .pop() ?? null;
    return { profileId: p.profileId, name: p.name, color: p.color, income, expenses, jointMonthly, firstMonth, memberStart };
  });

  // La convivencia requiere datos de al menos dos integranantes: si el segundo
  // perfil todavía no tiene movimientos, la vista conjunta va vacía con aviso.
  const withData = inputs.filter(m => m.firstMonth !== null);
  if (withData.length < 2) {
    return {
      members: [],
      monthly: [],
      totalIncome: 0,
      totalExpenses: 0,
      totalSavings: 0,
      savingsRate: null,
      averageMonthlyIncome: 0,
      averageMonthlyExpenses: 0,
      averageMonthlySavings: 0,
      averageSavingsRate: null,
      incomeMonthCount: 0,
      expenseMonthCount: 0,
      savingsMonthCount: 0,
      medianMonthlyIncome: 0,
      medianMonthlyExpenses: 0,
      medianMonthlySavings: 0,
      lastYearAvgIncome: 0,
      lastYearAvgExpenses: 0,
      lastYearAvgSavings: 0,
      jointTotal: 0,
      jointAverageMonthly: 0,
      currentMonthIncome: 0,
      currentMonthExpenses: 0,
      previousMonthIncome: 0,
      previousMonthExpenses: 0,
      categoryBreakdown: [],
      last12ByCategory: {},
      monthlyByCategory: {},
    };
  }

  // Ventana de convivencia: desde el momento más limitante, el primer mes en
  // que todos los perfiles con datos registran ingreso Y gasto de forma
  // continua (miembro con la serie más corta). Los movimientos que no afectan a
  // ingresos o gastos (traspasos, etc.) no adelantan la ventana: las medias se
  // calculan solo desde que todos los integrantes tienen ambas series.
  const starts = withData.map(m => m.memberStart).filter((s): s is string => s !== null);
  const windowStart = starts.length > 0 ? starts.sort().pop() ?? '' : '';

  const allMonths = new Set<string>();
  const incomeByMemberMonth = new Map<string, Map<string, number>>();
  const expensesByMemberMonth = new Map<string, Map<string, number>>();
  for (const m of inputs) {
    const inc = new Map<string, number>();
    for (const point of m.income.monthly) {
      if (point.month >= windowStart) inc.set(point.month, point.total);
    }
    incomeByMemberMonth.set(m.profileId, inc);
    const exp = new Map<string, number>();
    for (const point of m.expenses.monthly) {
      if (point.month >= windowStart) exp.set(point.month, point.total);
    }
    expensesByMemberMonth.set(m.profileId, exp);
    for (const month of inc.keys()) allMonths.add(month);
    for (const month of exp.keys()) allMonths.add(month);
    for (const month of m.jointMonthly.keys()) {
      if (month >= windowStart) allMonths.add(month);
    }
  }
  const months = [...allMonths].sort((a, b) => a.localeCompare(b));
  const current = currentMonthKey();

  const incomeByMonth = new Map<string, number>();
  const expensesByMonth = new Map<string, number>();
  for (const month of months) {
    let income = 0;
    let expenses = 0;
    for (const m of inputs) {
      income += incomeByMemberMonth.get(m.profileId)?.get(month) ?? 0;
      expenses += expensesByMemberMonth.get(m.profileId)?.get(month) ?? 0;
    }
    incomeByMonth.set(month, income);
    expensesByMonth.set(month, expenses);
  }

  const monthly: JointMonthPoint[] = months.map(month => {
    const income = incomeByMonth.get(month) ?? 0;
    const expenses = expensesByMonth.get(month) ?? 0;
    const savings = income - expenses;
    return { month, income, expenses, savings, savingsRate: income > 0 ? (savings / income) * 100 : null };
  });

  const jointByMonth = new Map<string, number>();
  for (const m of inputs) {
    for (const [month, value] of m.jointMonthly) {
      if (month >= windowStart) jointByMonth.set(month, (jointByMonth.get(month) ?? 0) + value);
    }
  }

  const members: JointMemberResult[] = inputs.map(m => {
    const incomeOfMember = incomeByMemberMonth.get(m.profileId)!;
    const monthlyRows: JointMemberMonth[] = months.map(month => {
      const joint = m.jointMonthly.get(month) ?? 0;
      const household = jointByMonth.get(month) ?? 0;
      const income = incomeOfMember.get(month) ?? 0;
      return {
        month,
        jointExpenses: joint,
        pct: household > 0 ? (joint / household) * 100 : null,
        pctOfIncome: income > 0 ? (joint / income) * 100 : null,
      };
    });

    const totalJoint = sum(monthlyRows.map(e => e.jointExpenses));
    const completed = monthlyRows.filter(e => e.month < current);
    const withIncome = completed.filter(e => (incomeOfMember.get(e.month) ?? 0) > 0);
    const averageMonthlyJoint = completed.length > 0 ? totalJoint / completed.length : 0;

    return {
      profileId: m.profileId,
      name: m.name,
      color: m.color,
      monthly: monthlyRows,
      totalJoint,
      averageMonthlyJoint,
      totalPct: 0,
      averagePctOfIncome: withIncome.length > 0 ? sum(withIncome.map(e => e.pctOfIncome ?? 0)) / withIncome.length : null,
    };
  });

  const jointTotalOverall = sum(members.map(m => m.totalJoint));
  for (const member of members) {
    member.totalPct = jointTotalOverall > 0 ? (member.totalJoint / jointTotalOverall) * 100 : 0;
  }

  const totalIncome = sum(monthly.map(p => p.income));
  const totalExpenses = sum(monthly.map(p => p.expenses));
  const totalSavings = totalIncome - totalExpenses;
  const completedPoints = monthly.filter(p => p.month < current);

  // Las medias se calculan con el mismo criterio que en el Agregador individual
  // (computeIncome / computeExpenses): sobre el rango de meses de cada serie,
  // contando los huecos intermedios, dentro de la ventana de convivencia.
  const householdIncome = mergeMonthly(incomeByMemberMonth.values());
  const incomeCompleted = completedMonths(householdIncome);
  const incomeSpan = monthSpan(incomeCompleted);
  const averageMonthlyIncome = incomeSpan > 0 ? sum(incomeCompleted.map(p => p.total)) / incomeSpan : 0;

  const householdExpenses = mergeMonthly(expensesByMemberMonth.values());
  const expenseCompleted = completedMonths(householdExpenses);
  const expenseSpan = monthSpan(expenseCompleted);
  const averageMonthlyExpenses = expenseSpan > 0 ? sum(expenseCompleted.map(p => p.total)) / expenseSpan : 0;

  const averageMonthlySavings = averageMonthlyIncome - averageMonthlyExpenses;
  const rates = completedPoints.filter(p => p.savingsRate !== null).map(p => p.savingsRate!);

  // Mediana y medias de los últimos 12 meses terminados, sobre la serie
  // mensual del hogar (misma base en los tres casos).
  const medianMonthlyIncome = median(completedPoints.map(p => p.income));
  const medianMonthlyExpenses = median(completedPoints.map(p => p.expenses));
  const medianMonthlySavings = median(completedPoints.map(p => p.savings));
  const lastYear = completedPoints.slice(-12);
  const lastYearAvgIncome = lastYear.length > 0 ? sum(lastYear.map(p => p.income)) / lastYear.length : 0;
  const lastYearAvgExpenses = lastYear.length > 0 ? sum(lastYear.map(p => p.expenses)) / lastYear.length : 0;
  const lastYearAvgSavings = lastYear.length > 0 ? sum(lastYear.map(p => p.savings)) / lastYear.length : 0;

  const currentMonthIncome = incomeByMonth.get(current) ?? 0;
  const currentMonthExpenses = expensesByMonth.get(current) ?? 0;
  const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const previousMonthKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

  // Serie mensual agregada para el hogar de TODAS las categorías de gasto (no
  // solo las conjuntas), dentro de la ventana de convivencia. Se usa para la
  // gráfica filtrada por categoría; el desglose conjunto filtra a los gastos conjuntos.
  const categoryByMonth = new Map<string, Map<string, number>>();
  for (const m of inputs) {
    for (const [cat, series] of Object.entries(m.expenses.monthlyByCategory)) {
      let byMonth = categoryByMonth.get(cat);
      if (!byMonth) {
        byMonth = new Map<string, number>();
        categoryByMonth.set(cat, byMonth);
      }
      for (const point of series) {
        if (point.month >= windowStart) {
          byMonth.set(point.month, (byMonth.get(point.month) ?? 0) + point.total);
        }
      }
    }
  }

  // Serie mensual y aportación por integrante para cada categoría que tenga
  // gastos conjuntos (heredados de jointCategories o sobreescritos como conjuntos),
  // dentro de la ventana de convivencia.
  const jointCategoryByMonth = new Map<string, Map<string, number>>();
  const memberByJointCategory = new Map<string, Array<Omit<CategoryMemberTotal, 'averageMonthly'>>>();

  for (const p of profiles) {
    const memberCatTotals = new Map<string, number>();
    for (const m of p.movements) {
      if (m.type !== 'expense' && m.type !== 'refund') continue;
      for (const split of expenseSplits(m)) {
        if (split.category === EXCLUDED_CATEGORY || !isExpenseSplitJoint(m, split, jointCategories)) continue;
        const month = m.date.slice(0, 7);
        if (month >= windowStart) {
          let byMonth = jointCategoryByMonth.get(split.category);
          if (!byMonth) {
            byMonth = new Map<string, number>();
            jointCategoryByMonth.set(split.category, byMonth);
          }
          byMonth.set(month, (byMonth.get(month) ?? 0) + signedAbs(m, split.amount));
          memberCatTotals.set(split.category, (memberCatTotals.get(split.category) ?? 0) + signedAbs(m, split.amount));
        }
      }
    }
    for (const [cat, total] of memberCatTotals) {
      if (total === 0) continue;
      const arr = memberByJointCategory.get(cat) ?? [];
      arr.push({ profileId: p.profileId, name: p.name, color: p.color, total });
      memberByJointCategory.set(cat, arr);
    }
  }

  const windowLastCompleted = expenseCompleted.length > 0 ? expenseCompleted[expenseCompleted.length - 1].month : null;

  const grossByCat = [...jointCategoryByMonth.values()].reduce(
    (acc, byMonth) => acc + Math.max([...byMonth.values()].reduce((s, v) => s + v, 0), 0),
    0,
  );

  const categoryBreakdown: CategoryTotal[] = [...jointCategoryByMonth.entries()]
    .map(([category, byMonth]) => {
      const points = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const total = points.reduce((s, [, v]) => s + v, 0);
      const firstDate = points.length > 0 ? `${points[0][0]}-01` : '';
      const lastMonth = byMonth.get(current) ?? 0;
      let averageMonthly = 0;
      let months = 0;
      if (windowLastCompleted && firstDate) {
        const [fy, fm] = firstDate.split('-').map(Number);
        const [ly, lm] = windowLastCompleted.split('-').map(Number);
        months = Math.max(1, (ly - fy) * 12 + (lm - fm) + 1);
        averageMonthly = total / months;
      }
      const byMember = (memberByJointCategory.get(category) ?? []).map(mb => ({
        ...mb,
        averageMonthly: months > 0 ? mb.total / months : 0,
      }));
      return {
        category,
        total,
        pct: grossByCat > 0 ? (Math.max(total, 0) / grossByCat) * 100 : 0,
        averageMonthly,
        firstDate,
        lastMonth,
        byMember,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Media mensual de los últimos 12 meses calendario, igual que el desglose
  // individual: la ventana se ancla al último mes terminado de la convivencia.
  const last12ByCategory: Record<string, number> = {};
  if (windowLastCompleted) {
    const [year, month] = windowLastCompleted.split('-').map(Number);
    const windowMonths: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(year, month - 1 - i, 1));
      windowMonths.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    for (const [cat, byMonth] of jointCategoryByMonth) {
      let s = 0;
      for (const mk of windowMonths) s += byMonth.get(mk) ?? 0;
      last12ByCategory[cat] = s / 12;
    }
  }

  // Serie mensual de cada categoría conjunta agregada para el hogar, para la
  // gráfica filtrada por categoría.
  const monthlyByCategory: Record<string, MonthPoint[]> = {};
  for (const [cat, byMonth] of categoryByMonth) {
    monthlyByCategory[cat] = [...byMonth.entries()]
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  return {
    members,
    monthly,
    totalIncome,
    totalExpenses,
    totalSavings,
    savingsRate: totalIncome > 0 ? (totalSavings / totalIncome) * 100 : null,
    averageMonthlyIncome,
    averageMonthlyExpenses,
    averageMonthlySavings,
    averageSavingsRate: rates.length > 0 ? sum(rates) / rates.length : null,
    incomeMonthCount: incomeSpan,
    expenseMonthCount: expenseSpan,
    savingsMonthCount: monthSpan(completedPoints.map(p => ({ month: p.month, total: p.savings }))),
    medianMonthlyIncome,
    medianMonthlyExpenses,
    medianMonthlySavings,
    lastYearAvgIncome,
    lastYearAvgExpenses,
    lastYearAvgSavings,
    jointTotal: jointTotalOverall,
    jointAverageMonthly: completedPoints.length > 0 ? jointTotalOverall / completedPoints.length : 0,
    currentMonthIncome,
    currentMonthExpenses,
    previousMonthIncome: incomeByMonth.get(previousMonthKey) ?? 0,
    previousMonthExpenses: expensesByMonth.get(previousMonthKey) ?? 0,
    categoryBreakdown,
    last12ByCategory,
    monthlyByCategory,
  };
}