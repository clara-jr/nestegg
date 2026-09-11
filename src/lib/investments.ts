import type { Movement } from './bankImports';

// ---------------------------------------------------------------------------
// Cartera (ETFs, acciones y fondos)
// ---------------------------------------------------------------------------

export interface Holding {
  key: string;
  name: string;
  isin?: string;
  ticker?: string;
  /** Clase de activo declarada por el banco (FUND, STOCK…). */
  assetClass?: string;
  shares: number;
  /** Precio medio por participación: solo importe de las compras, sin comisiones. */
  avgPrice: number;
  /** Coste pendiente (participaciones × precio medio), sin comisiones. */
  investedCost: number;
  currentPrice: number;
  priceSource: 'stored' | 'fallback';
  value: number;
  realizedPnl: number;
  dividends: number;
  unrealizedPnl: number;
  totalPnl: number;
  /** Fecha ISO de la primera compra registrada para el producto. */
  firstBuyDate?: string;
  /** TIR % anual indicada por el usuario para un depósito a plazo. */
  plazoRate?: number;
  /** Duración del plazo en meses, indicada por el usuario. */
  plazoMonths?: number;
  /** Ganancia prevista al vencimiento del plazo (solo con TIR y duración). */
  plazoProjectedGain?: number;
}

export interface PortfolioSummary {
  investedCost: number;
  currentValue: number;
  realized: number;
  unrealized: number;
  dividends: number;
  /** Comisiones e impuestos: movimientos propios más los cobrados en compras/ventas. */
  feesAndTaxes: number;
  totalBenefit: number;
}

export interface PortfolioResult {
  holdings: Holding[];
  summary: PortfolioSummary;
}

/** Parámetros que el usuario declara para un depósito a plazo: TIR anual (%)
 *  y duración (meses). Sirven para estimar la ganancia al vencimiento. */
export interface PlazoFijoConfig {
  rate: number;
  months: number;
}

interface HoldingAccumulator {
  name: string;
  isin?: string;
  ticker?: string;
  assetClass?: string;
  shares: number;
  cost: number;
  realized: number;
  dividends: number;
  /** Interés pendiente de cobro: se acumula en depósitos a plazo y solo se
   *  reclasifica como «realized» cuando el plazo se vende totalmente. */
  pendingInterest: number;
  firstBuyDate?: string;
}

function holdingKey(movement: Movement): string {
  return movement.isin ?? movement.ticker ?? movement.concept.trim().toUpperCase();
}

const PLAZO_FIJO_RE = /CONST\.?\s*AHORRO|CANC\w*\.?\s*.*AHORRO|DEPOSITO|APORTE.*PLAZO|PLAZO.*APORTE|INTERES.*PLAZO|PLAZO.*INTERES/i;
function isPlazoFijo(m: Movement): boolean {
  return PLAZO_FIJO_RE.test(m.concept) && (m.type === 'buy' || m.type === 'sell');
}
/** Intereses de plazo fijo: se clasifican como «sell» en el parser pero son
 *  intereses acumulados, no devoluciones de capital. */
const PLAZO_INTEREST_RE = /INTERES.*PLAZO|PLAZO.*INTERES/i;
function isPlazoFijoInterest(m: Movement): boolean {
  return PLAZO_INTEREST_RE.test(m.concept);
}

/** Formatea YYYY-MM-DD → DD-MM-YYYY para el nombre del plazo fijo. */
function formatPlazoName(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

export function computePortfolio(
  movements: Movement[],
  getPrice: (key: string, ticker?: string, isin?: string) => number | undefined,
  plazoConfig?: Record<string, PlazoFijoConfig>
): PortfolioResult {
  const sorted = [...movements].sort((a, b) => a.date.localeCompare(b.date));
  const accs = new Map<string, HoldingAccumulator>();
  let accountFeesAndTaxes = 0;
  // Clave del depósito a plazo abierto por banco (s uno a la vez).
  const currentPlazo = new Map<string, string>();

  for (const m of sorted) {
    if (m.type === 'fee' || m.type === 'tax') {
      accountFeesAndTaxes += Math.abs(m.amount);
      continue;
    }

    if (m.type !== 'buy' && m.type !== 'sell' && m.type !== 'dividend') continue;
    // En MyInvestor, las compras/ventas de la cuenta representan traspasos de
    // efectivo a fondos; la suscripción real (con participaciones) está en el
    // fichero de fondos (fundOperation). Solo contamos las del fichero de fondos.
    if (m.bank === 'myinvestor' && !m.fundOperation) continue;

    // -------------------------------------------------------------------------
    // Depósitos a plazo: modelo por instancia
    // Cada compra abre un nuevo «Plazo Fijo DD-MM-YYYY». Los intereses se
    // acumulan internamente (pendingInterest) y solo se reclasifican como
    // «realized» cuando el plazo se vende por completo.
    // -------------------------------------------------------------------------
    if (isPlazoFijo(m)) {
      if (m.type === 'buy') {
        const name = `Plazo Fijo ${formatPlazoName(m.date)}`;
        const key = `plazo-fijo|${m.bank}|${m.date}`;
        const acc: HoldingAccumulator = {
          name,
          assetClass: 'plazo-fijo',
          shares: Math.abs(m.amount),
          cost: Math.abs(m.amount),
          realized: 0,
          dividends: 0,
          pendingInterest: 0,
          firstBuyDate: m.date,
        };
        accs.set(key, acc);
        currentPlazo.set(m.bank, key);
      } else {
        // Sell o dividend: buscar el plazo abierto de este banco.
        // Si no hay plazo abierto pero es un interés, buscar el último plazo
        // de este banco (puede estar ya cerrado).
        let key = currentPlazo.get(m.bank);
        let acc = key ? accs.get(key) : undefined;

        if (!acc && isPlazoFijoInterest(m) && m.type === 'sell') {
          let latestDate = '';
          for (const [k, a] of accs) {
            if (a.assetClass === 'plazo-fijo' && k.startsWith(`plazo-fijo|${m.bank}|`)) {
              const d = k.split('|')[2];
              if (d > latestDate) { latestDate = d; key = k; acc = a; }
            }
          }
        }

        if (!acc) {
          // No hay plazo (abierto ni cerrado): ignorar.
          accountFeesAndTaxes += Math.abs(m.fee ?? 0);
          continue;
        }

        if (m.type === 'sell') {
          if (isPlazoFijoInterest(m)) {
            // Intereses del plazo: acumular sin tocar capital.
            acc.pendingInterest += Math.abs(m.amount);
          } else {
            // Devolución de capital: reducir coste y participaciones.
            acc.cost = Math.max(0, acc.cost - Math.abs(m.amount));
            acc.shares = acc.cost;
            accountFeesAndTaxes += Math.abs(m.fee ?? 0);

            // Si se vende todo (shares ≈ 0), cerrar el plazo.
            // Los intereses se mantienen en pendingInterest para «Recibido».
            if (acc.shares <= 1e-9) {
              acc.shares = 0;
              acc.cost = 0;
              currentPlazo.delete(m.bank);
            }
          }
        } else {
          // dividend: acumular como intereses pendientes.
          acc.pendingInterest += Math.abs(m.amount);
        }
      }
      continue;
    }

    // -------------------------------------------------------------------------
    // Resto de productos (ETFs, acciones, fondos…)
    // -------------------------------------------------------------------------
    const key = holdingKey(m);
    let acc = accs.get(key);
    if (!acc) {
      acc = {
        name: m.concept,
        isin: m.isin,
        ticker: m.ticker,
        assetClass: m.assetClass,
        shares: 0,
        cost: 0,
        realized: 0,
        dividends: 0,
        pendingInterest: 0,
      };
      accs.set(key, acc);
    }
    if (!acc.ticker && m.ticker) acc.ticker = m.ticker;
    if (!acc.isin && m.isin) acc.isin = m.isin;
    if (!acc.assetClass && m.assetClass) acc.assetClass = m.assetClass;

    const sharesAmount = Math.abs(m.shares ?? 0);

    if (m.type === 'dividend') {
      acc.dividends += Math.abs(m.amount);
      continue;
    }

    if (m.type === 'buy') {
      const quantity = sharesAmount > 0 ? sharesAmount : Math.abs(m.amount);
      const unitPrice = m.price ?? (quantity > 0 ? Math.abs(m.amount) / quantity : 0);
      acc.firstBuyDate ??= m.date;
      acc.shares += quantity;
      // Las comisiones no forman parte del precio de las participaciones: el
      // coste solo suma participaciones × precio y la comisión va a su propio
      // bucket (feesAndTaxes), igual que los movimientos de tipo comisión.
      acc.cost += quantity * unitPrice;
      accountFeesAndTaxes += Math.abs(m.fee ?? 0);
    } else if (m.type === 'sell') {
      const quantity = sharesAmount > 0 ? sharesAmount : Math.abs(m.amount);
      const avgCost = acc.shares > 0 ? acc.cost / acc.shares : 0;
      const soldShares = Math.min(quantity, acc.shares > 0 ? acc.shares : quantity);
      const soldCost = avgCost * soldShares;
      acc.realized += Math.abs(m.amount) - soldCost;
      accountFeesAndTaxes += Math.abs(m.fee ?? 0);
      acc.shares -= soldShares;
      acc.cost = Math.max(0, acc.cost - soldCost);
      if (acc.shares <= 1e-9) {
        acc.shares = 0;
        acc.cost = 0;
      }
    }
  }

  const holdings: Holding[] = [];
  for (const [key, acc] of accs) {
    if (acc.assetClass !== 'plazo-fijo' && acc.shares <= 1e-9 && Math.abs(acc.realized) < 1e-9 && acc.dividends <= 1e-9 && acc.pendingInterest <= 1e-9) continue;
    const avgPrice = acc.shares > 0 ? acc.cost / acc.shares : 0;
    const storedPrice = getPrice(key, acc.ticker, acc.isin);
    const priceSource = storedPrice !== undefined ? 'stored' : 'fallback';
    const currentPrice = storedPrice ?? avgPrice;
    const value = acc.shares * currentPrice;
    // Para depósitos a plazo, «Recibido» (realizedPnl) es únicamente el
    // interés acumulado; la devolución de capital solo reduce Invertido/Valor.
    const isPF = acc.assetClass === 'plazo-fijo';

    // Depósito a plazo con TIR y duración declaradas por el usuario: «Latente»
    // estima la ganancia prevista al vencimiento menos el interés ya cobrado
    // (que va a «Recibido»), de modo que Total = ganancia completa del plazo.
    let unrealizedPnl = value - acc.cost;
    let plazoRate: number | undefined;
    let plazoMonths: number | undefined;
    let plazoProjectedGain: number | undefined;
    if (isPF) {
      const cfg = plazoConfig?.[key];
      if (cfg && cfg.rate > 0 && cfg.months > 0 && acc.cost > 0) {
        plazoRate = cfg.rate;
        plazoMonths = cfg.months;
        plazoProjectedGain = acc.cost * (cfg.rate / 100) * (cfg.months / 12);
        unrealizedPnl = Math.max(0, plazoProjectedGain - acc.pendingInterest);
      } else {
        unrealizedPnl = 0;
      }
    }

    holdings.push({
      key,
      name: acc.name,
      isin: acc.isin,
      ticker: acc.ticker,
      assetClass: acc.assetClass,
      shares: acc.shares,
      avgPrice,
      investedCost: acc.cost,
      currentPrice,
      priceSource,
      value,
      realizedPnl: isPF ? acc.pendingInterest : acc.realized,
      dividends: isPF ? 0 : acc.dividends,
      unrealizedPnl,
      totalPnl: (isPF ? acc.pendingInterest : acc.realized) + unrealizedPnl + (isPF ? 0 : acc.dividends),
      firstBuyDate: acc.firstBuyDate,
      plazoRate,
      plazoMonths,
      plazoProjectedGain,
    });
  }

  holdings.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  const summary: PortfolioSummary = {
    investedCost: holdings.reduce((sum, h) => sum + h.investedCost, 0),
    currentValue: holdings.reduce((sum, h) => sum + h.value, 0),
    realized: holdings.reduce((sum, h) => sum + h.realizedPnl, 0),
    unrealized: holdings.reduce((sum, h) => sum + h.unrealizedPnl, 0),
    dividends: holdings.reduce((sum, h) => sum + h.dividends, 0),
    feesAndTaxes: accountFeesAndTaxes,
    totalBenefit: 0,
  };
  summary.totalBenefit =
    summary.realized + summary.unrealized + summary.dividends;

  return { holdings, summary };
}

// ---------------------------------------------------------------------------
// Series temporales genéricas
// ---------------------------------------------------------------------------

export interface MonthPoint {
  month: string;
  total: number;
}

export interface YearPoint {
  year: string;
  total: number;
}

export function aggregateByMonth(movements: Movement[], absolute = true): MonthPoint[] {
  const totals = new Map<string, number>();
  for (const m of movements) {
    const month = m.date.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + (absolute ? Math.abs(m.amount) : m.amount));
  }
  return [...totals.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function aggregateByYear(movements: Movement[]): YearPoint[] {
  const totals = new Map<string, number>();
  for (const m of movements) {
    const year = m.date.slice(0, 4);
    totals.set(year, (totals.get(year) ?? 0) + Math.abs(m.amount));
  }
  return [...totals.entries()]
    .map(([year, total]) => ({ year, total }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

/** Clave YYYY-MM del mes en curso, que todavía no ha terminado. */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Filtra una serie mensual dejando solo los meses ya terminados, excluyendo
 *  el mes en curso porque todavía está en marcha y solo aporta datos parciales. */
export function completedMonths(points: MonthPoint[]): MonthPoint[] {
  const cur = currentMonthKey();
  return points.filter(p => p.month < cur);
}

/** Mediana aritmética de un conjunto de valores (0 si está vacío). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------------------------------------------------------------------------
// Intereses
// ---------------------------------------------------------------------------

export interface InterestSummary {
  total: number;
  gross: number;
  withheld: number;
  monthly: MonthPoint[];
  yearly: YearPoint[];
  averageMonthly: number;
  currentYear: number;
}

/** Interés neto: importe abonado menos la retención (columna tax) si la hay. */
export function interestNetAmount(movement: Movement): number {
  return Math.abs(movement.amount) - Math.abs(movement.tax ?? 0);
}

export function computeInterest(
  interestMovements: Movement[],
  taxOnInterest?: Movement[],
): InterestSummary {
  const monthTotals = new Map<string, number>();
  const yearTotals = new Map<string, number>();
  let gross = 0;
  let withheld = 0;

  for (const m of interestMovements) {
    const net = interestNetAmount(m);
    gross += Math.abs(m.amount);
    withheld += Math.abs(m.tax ?? 0);
    const month = m.date.slice(0, 7);
    const year = m.date.slice(0, 4);
    monthTotals.set(month, (monthTotals.get(month) ?? 0) + net);
    yearTotals.set(year, (yearTotals.get(year) ?? 0) + net);
  }

  // Restar impuestos sobre intereses que vienen como movimientos separados
  // (p. ej. MyInvestor «LIQ INTERESES» con importe negativo).
  for (const t of taxOnInterest ?? []) {
    withheld += Math.abs(t.amount);
    const month = t.date.slice(0, 7);
    const year = t.date.slice(0, 4);
    monthTotals.set(month, (monthTotals.get(month) ?? 0) + t.amount);
    yearTotals.set(year, (yearTotals.get(year) ?? 0) + t.amount);
  }

  const monthly: MonthPoint[] = [...monthTotals.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const yearly: YearPoint[] = [...yearTotals.entries()]
    .map(([year, total]) => ({ year, total }))
    .sort((a, b) => a.year.localeCompare(b.year));

  const total = monthly.reduce((sum, p) => sum + p.total, 0);
  const span = monthSpan(monthly);
  return {
    total,
    gross,
    withheld,
    monthly,
    yearly,
    averageMonthly: span > 0 ? total / span : 0,
    currentYear: yearly.find(y => y.year === String(new Date().getFullYear()))?.total ?? 0,
  };
}

/**
 * Saldo de efectivo reconstruido sumando el importe firmado de todos los
 * movimientos (ingresos, compras/ventas, dividendos, intereses, gastos,
 * traspasos…), excluyendo únicamente las operaciones de fondos que ya se
 * tracksan por separado en el fichero de fondos (fundOperation). De cada
 * movimiento se restan su retención (columna tax) y sus comisiones (columna
 * fee): los bancos abonan intereses/dividendos netos y cobran las comisiones
 * aparte del importe.
 *
 * Los traspasos se incluyen: un traspaso positivo (dinero que sale de la
 * cuenta hacia inversiones) reduce el saldo, y uno negativo (retirada de
 * inversiones a la cuenta) lo aumenta. Para bancos que reportan saldo
 * explícito (p. ej. CaixaBank), el saldo ya refleja los traspasos, por lo
 * que se usa directamente sin sumar flujos adicionales.
 */
export function computeCashBalance(movements: Movement[]): number {
  const flowSum = (list: Movement[]) =>
    list.reduce(
      (sum, m) =>
        m.fundOperation
          ? sum
          : sum + m.amount - Math.abs(m.tax ?? 0) - Math.abs(m.fee ?? 0),
      0,
    );

  // Buscar bancos que reportan saldo explícito (p. ej. CaixaBank).
  const balanceByBank = new Map<string, number>();
  const lastBalanceDate = new Map<string, string>();
  const transferPairs = paypalTransferPairIds(movements);
  for (const m of movements) {
    if (m.balance === undefined || m.balance === null) continue;
    const prev = lastBalanceDate.get(m.bank);
    // En PayPal, si el movimiento de fecha más reciente forma parte de una
    // pareja gasto/devolución - traspaso del mismo día, se prefiere el saldo
    // del traspaso (es el que refleja el saldo real de la cuenta).
    const preferTransferPair = m.bank === 'paypal' && transferPairs.has(m.id);
    if (!prev || m.date > prev || (m.date === prev && preferTransferPair)) {
      balanceByBank.set(m.bank, m.balance);
      lastBalanceDate.set(m.bank, m.date);
    }
  }

  if (balanceByBank.size === 0) return flowSum(movements);

  // Para bancos con saldo, usar el saldo real; para el resto, sumar flujos.
  const banksWithBalance = new Set(balanceByBank.keys());
  const otherFlow = flowSum(movements.filter(m => !banksWithBalance.has(m.bank)));
  let total = otherFlow;
  for (const balance of balanceByBank.values()) {
    total += balance;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Evolución de la cuenta (aportaciones + intereses)
// ---------------------------------------------------------------------------

export interface AccountEvolutionPoint {
  month: string;
  /**
   * Dinero propio acumulado en efectivo excluyendo intereses: ingresos,
   * retiradas, compras/ventas de valores, dividendos, perks y gastos. Con los
   * intereses reproduce el saldo reconstruido por computeCashBalance.
   */
  contributed: number;
  /** Intereses netos acumulados. */
  interest: number;
}

export interface AccountSummary {
  evolution: AccountEvolutionPoint[];
  /** Valor final de la serie de dinero propio (contributed): con los intereses suma el saldo en cuenta. */
  totalContributed: number;
  /** Invertido en cartera: compras − ventas (importe de las órdenes; las comisiones van como movimientos propios). */
  totalInvested: number;
  /** Intereses netos acumulados. */
  totalInterest: number;
}

/**
 * Serie acumulada mes a mes con la evolución del efectivo de la cuenta
 * remunerada dividida en dos partes: el dinero propio (todos los flujos menos
 * los intereses) y los intereses generados. Cada movimiento aporta su flujo de
 * caja (importe firmado menos retenciones y comisiones cobradas aparte), igual
 * que hace computeCashBalance, de modo que aportado + intereses coinciden con
 * el saldo en cuenta en el último punto de la serie.
 */
export function computeAccountEvolution(movements: Movement[]): AccountSummary {
  const buckets = new Map<string, { contributed: number; interest: number }>();
  const ensure = (month: string) => {
    let bucket = buckets.get(month);
    if (!bucket) {
      bucket = { contributed: 0, interest: 0 };
      buckets.set(month, bucket);
    }
    return bucket;
  };

  let totalInvested = 0;

  for (const m of movements) {
    // Solo se excluyen las operaciones de fondos (que tienen su propio fichero).
    // Los traspasos SÍ se incluyen: un depósito positivo reduce el efectivo
    // (se invierte en cartera) y una retirada lo aumenta.
    if (m.fundOperation) continue;
    const flow = m.amount - Math.abs(m.tax ?? 0) - Math.abs(m.fee ?? 0);
    const bucket = ensure(m.date.slice(0, 7));
    if (m.type === 'interest') {
      bucket.interest += flow;
    } else if (m.type === 'tax' && /INTERES/i.test(m.concept)) {
      // Impuestos sobre intereses (p. ej. MyInvestor «LIQ INTERESES»): reducen
      // los intereses netos en vez de ir a contribuido.
      bucket.interest += flow;
    } else {
      bucket.contributed += flow;
    }
    if (m.type === 'buy' || m.type === 'sell' || (m.type === 'transfer' && flow < 0)) {
      // Compra/depósito: el efectivo pasa a cartera; venta/retirada: vuelve.
      totalInvested -= flow;
    }
  }

  const months = [...buckets.keys()].sort();
  let contributed = 0;
  let interest = 0;
  const evolution = months.map(month => {
    const bucket = buckets.get(month)!;
    contributed += bucket.contributed;
    interest += bucket.interest;
    return { month, contributed, interest };
  });

  return {
    evolution,
    totalContributed: contributed,
    totalInvested,
    totalInterest: interest,
  };
}

// ---------------------------------------------------------------------------
// Desglose por banco
// ---------------------------------------------------------------------------

export interface BankBreakdownEntry {
  bank: string;
  /** Saldo actual (último balance si está disponible, o suma de flujos). */
  balance: number;
  /** Intereses netos acumulados. */
  interest: number;
  /** Número de movimientos del banco. */
  movementCount: number;
}

/**
 * Ids de los movimientos de PayPal que son un traspaso por el que entra o sale
 * dinero asociado a un gasto/devolución hermano (misma fecha e importe en
 * valor absoluto). Para estos pares se prefiere el saldo del traspaso al elegir
 * el saldo de la cuenta PayPal: el traspaso es el que refleja el saldo real.
 */
function paypalTransferPairIds(movements: Movement[]): Set<string> {
  const byKey = new Map<string, { transfer: string[]; spend: string[] }>();
  for (const m of movements) {
    if (m.bank !== 'paypal') continue;
    const isTransfer = m.type === 'transfer';
    const isSpend = m.type === 'expense' || m.type === 'refund';
    if (!isTransfer && !isSpend) continue;
    const key = `${m.date}|${Math.abs(m.amount).toFixed(4)}`;
    const bucket = byKey.get(key) ?? { transfer: [], spend: [] };
    if (isTransfer) bucket.transfer.push(m.id);
    else bucket.spend.push(m.id);
    byKey.set(key, bucket);
  }
  const ids = new Set<string>();
  for (const { transfer, spend } of byKey.values()) {
    if (transfer.length > 0 && spend.length > 0) {
      for (const id of transfer) ids.add(id);
    }
  }
  return ids;
}

/**
 * Devuelve un desglose por banco del saldo actual y los intereses acumulados.
 * Para bancos que reportan saldo explícito (p. ej. CaixaBank), se usa el
 * último balance; para el resto, se reconstruye sumando flujos.
 */
export function computeBankBreakdown(movements: Movement[]): BankBreakdownEntry[] {
  const byBank = new Map<string, { balance: number; interest: number; count: number; lastDate: string; hasExplicitBalance: boolean }>();

  const ensure = (bank: string) => {
    let entry = byBank.get(bank);
    if (!entry) {
      entry = { balance: 0, interest: 0, count: 0, lastDate: '', hasExplicitBalance: false };
      byBank.set(bank, entry);
    }
    return entry;
  };

  // Primera pasada: detectar bancos con saldo explícito y acumular intereses.
  const transferPairs = paypalTransferPairIds(movements);
  for (const m of movements) {
    const entry = ensure(m.bank);
    entry.count++;
    if (m.balance !== undefined && m.balance !== null) {
      const preferTransferPair = m.bank === 'paypal' && transferPairs.has(m.id);
      if (!entry.hasExplicitBalance || m.date > entry.lastDate || (m.date === entry.lastDate && preferTransferPair)) {
        entry.balance = m.balance;
        entry.lastDate = m.date;
        entry.hasExplicitBalance = true;
      }
    }
    if (m.type === 'interest') {
      entry.interest += m.amount - Math.abs(m.tax ?? 0) - Math.abs(m.fee ?? 0);
    } else if (m.type === 'tax' && /INTERES/i.test(m.concept)) {
      entry.interest += m.amount;
    }
  }

  // Segunda pasada: para bancos sin saldo explícito, reconstruir sumando flujos.
  for (const m of movements) {
    const entry = byBank.get(m.bank)!;
    if (entry.hasExplicitBalance) continue;
    if ((m.type === 'transfer' && m.amount < 0) || m.fundOperation) continue;
    entry.balance += m.amount - Math.abs(m.tax ?? 0) - Math.abs(m.fee ?? 0);
  }

  return [...byBank.entries()]
    .map(([bank, e]) => ({
      bank,
      balance: e.balance,
      interest: e.interest,
      movementCount: e.count,
    }))
    .sort((a, b) => b.balance - a.balance);
}

/** Número de meses completo entre el primero y el último de una serie
 *  mensual, incluyendo los huecos intermedios (meses sin actividad). */
export function monthSpan(monthly: MonthPoint[]): number {
  if (monthly.length === 0) return 0;
  const first = monthly[0].month;
  const last = monthly[monthly.length - 1].month;
  const [fy, fm] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  return (ly - fy) * 12 + (lm - fm) + 1;
}

/** Rellena una serie mensual con los meses intermedios sin actividad (total 0)
 *  entre su primer y último mes (o entre el rango que se indique). Útil para
 *  las gráficas, para que los meses con cifra 0 no desaparezcan del eje. */
export function fillMonthly(
  points: Array<{ month: string; total: number }>,
  start?: string,
  end?: string,
): Array<{ month: string; total: number }> {
  const first = start ?? points[0]?.month;
  const last = end ?? points[points.length - 1]?.month;
  if (!first || !last || last < first) return points;
  const byMonth = new Map(points.map(p => [p.month, p.total]));
  const [fy, fm] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  const out: Array<{ month: string; total: number }> = [];
  for (let i = 0; i <= (ly - fy) * 12 + (lm - fm); i++) {
    const d = new Date(Date.UTC(fy, fm - 1 + i, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ month, total: byMonth.get(month) ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

export const EXPENSE_CATEGORY_LIST = [
  'Alimentación',
  'Animales',
  'Donaciones',
  'Educación',
  'Electrónica',
  'Excluido',
  'Gimnasio',
  'Ocio y cultura',
  'Otros',
  'Peluquería y cosmética',
  'Regalos',
  'Restaurantes y delivery',
  'Ropa',
  'Salud',
  'Seguros',
  'Suministros e Internet',
  'Suscripciones',
  'Trabajo',
  'Transporte',
  'Viajes',
  'Vivienda',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORY_LIST)[number];

const CATEGORY_KEYWORDS: ReadonlyArray<[ExpenseCategory, RegExp]> = [
  ['Animales', /VETERINAR|HV VETERIOS|VERACR|VERACRUZ|UNAVETS GF|ERVET|HVCHOPERA|FUNDACION ROF COD|ZOOPLUS|CANICROSS|KIWOKO|DIAGER VET|GATTOS/],
  ['Peluquería y cosmética', /PELUQUERIA|COLORES Y FORMAS/],
  ['Gimnasio', /AYTO MADRID DEPOR|AYTO.MADRID-DEPOR|\bGYM\b|GIMNASIO|VIVAGYM|ANYTIME FITNESS|BASIC FIT/],
  ['Regalos', /REGALO|CUMPLE/],
  ['Suscripciones', /SPOTI|NETFLIX|HBO|HBO\s?MAX|MAX\.COM|DISNEY|SPOTIFY|APPLE\.COM|APPLE BILL|ICLOUD|GOOGLE (ONE|STORAGE)|YOUTUBE|AMAZON PRIME|PRIME VIDEO|MICROSOFT 365|M365|NORDVPN|PATREON|CHATGPT|OPENAI|ANTHROPIC|CLAUDE|GITHUB|NOTION|DROPBOX|CRUNCHYROLL|DAZN|MUBI|FILMIN/],
  ['Alimentación', /MERCADONA|SUPERMERCADO|TESCO|MANPER|COSTCO|ALCAMPO|CARREFOUR|CARREF|BM|LIDL|ALDI|\bDIA\b|SUPER (COR|AMARA)|AHORRAMAS|EROSKI|CONDIS|ALIMENTACION|FRUTERIA|CARNICERIA|PANADERIA|SUMA\b|COVIRAN|MAS Y MAS|BONPREU|CAPRABO|SPAR|REWE|SORLI/],
  ['Restaurantes y delivery', /RESTAURANT|PORFIADOS|CHAMPION|MACAO|RODILLA|PASTELERIA|LATERAL|CALEIDO|KAMADO|CENA|VEGAN|SANDWICH|PIRATAS|DISTRITO|CERVE|HELADERIA|ITALIAN|UNICA 4U|UNICA4U|REST\.|\bBAR\b|CAFETERIA|CAFE|MCDONALDS?|BURGER KING|\bKFC\b|TELEPIZZA|DOMINOS|PANOTECCA|PIZZA|GLOVO|UBER\*?(EATS)?|JUST EAT|RAPPI|TAQUiza|SUSHI|KEBAB|CERVEZERIA|TABERNA|ASADOR|TAPERIA|VERMUT/],
  ['Transporte', /RENFE|MPASS|TVR EMV MADRID|APP CRTM|\bMETRO\b|\bEMT\b|\bTMB\b|CABIFY|\bBOLT\b|\bUBER\b|TAXI|REPSOL|CEPSA|SHELL|GASOLINERA|PARKING|APARCAMIENTO|BICIMAD|LIME BIKES?\b|MOVO|ZITY|VOI TECHNOLOGY|TIER MOBILITY|ALSA|AVANZA|\bBUS\b|ESTACION|PEAJE|ITPARKING|EMAUSA|TUSGSAL|TAXI/],
  ['Vivienda', /ALQUILER|TRAMASMAS|IKEA|LEROY MERLIN|LEROY|REDOUTE|ARRENDAMIENTO|HIPOTECA|COMUNIDAD DE|ADMINISTRADOR FINCAS|INMOBILIARIA|IBI\b|COMUNIDAD|CDAD/],
  ['Suministros e Internet', /NUBOIL ENERGIA|ENERGIA XXI|REGULADA|GAS POWER|IBERDROLA|ENDESA|NATURGY|HOLALUZ|TOTALenergies|TOTALENERGIES|ACCIONA ENERGIA|AGUA|CANAL ISABEL|AQUALIA|EMASA|MOVISTAR|VODAFONE|ORANGE|JAZZTEL|MASMOVIL|PEPEPHONE|TELEFONICA|FINETWORK|LOVYCOM|ADSL|FIBRA|DIGI|SIMYO/],
  ['Salud', /FARMACIA|FCIA|FISSIOS|PARAFARMACIA|DENTISTA|DENTAL|ODONTOL|OPTICA|METALETIX|SANITAS|ADESLAS|DKV|ASI CASA|FISIO|PSICOLOG|VADEMECUM/],
  ['Seguros', /MAPFRE|MUTUA MADRILENA|AUTOMOVILISTA|LINEA DIRECTA|ALLIANZ|\bAXA\b|SEGUROS|ASEGURADORA|GENIUS INSURANCE|LAMAIGNERE|ARAG|FIATC|OCASO/],
  ['Viajes', /BOOKING|IBERIAEXPR|AIRBNB|RYANAIR|VUELING|IBERIA EXPRESS|\bIBERIA\b|AENA|EDREAMS|EXPEDIA|HOTEL|MELIA|AIR EUROPA|EASYJET|SKYSCANNER|TRAINLINE|OMIO|ASTUN|CANDANCHU|FORMIGAL/],
  //['Educación', /UNIVERSIDAD|MATRICULA|COLEGIO|MASTERD|CAMPUS|COURSERA|UDEMY|UDACITY|ACADEMIA|ESCUELA|GUARDERIA/],
  ['Ocio y cultura', /\bCINE\b|KINEPOLIS|GOLEM|SALA|YELMO|WEGOW|TAQUILLA|CINE|SONORAMA|CINESA|PALMTROPIC|ZACATRUS|TEATRO|CONCER|CONCIERTO|MUSIC|FESTI|WIZINK|RIVIERA|TICKETMASTER|ENTRADAS\.COM|MUSEO|EXPOSICION|STEAM|PLAYSTATION|\bXBOX\b|NINTENDO|EPIC GAMES|LIBRERIA|PAPELERIA|FNAC\b/],
  ['Ropa', /ZARA|ZALANDO|C&A|PARFOIS|WOMEN S SECRET|WOMEN SECRET|INTIMISSIMI|DESIGUAL|NIKE|H&M|PULL AND BEAR|NEWYORKER|OYSHO|CALZEDONIA|INSIDE|HUNKEMOLLER|MANGO|BERSHKA|PULL&BEAR|STRADIVARIUS|MASSIMO DUTTI|SPRINGFIELD|CORTEFIEL|EL CORTE INGLES|DECATHLON|SHEIN|ASOS|PRIMARK/],
  ['Electrónica', /MEDIA MARKT|MEDIAMARKT|PC COMPONENTES|PCCLASES|MIRAVIA|\bELVIRA GOMEZ\b|FNAC\b|WORTEN|EL CORTE INGLES|\bAPPLESTORE\b|APPLE STORE|\bAPPLE\b|K-TUIN|\bLG ELECTRONICS\b|SONY|SAMSUNG|TECHNOPC|PIXMANIA|WALMART ELECTRONICS|RADIO ELECTRONICA|ELECTRONICA|TELECOMUNICACIONES|XIAOMI|HUAWEI|ONE PLUS|ONEPLUS|EARBUDS|HEADPHONES|AURICULARES|MOVIL|SMARTPHONE|TELEFONO|TABLET|PORTATIL|ORDENADOR|GAMING|KPOP PLACE/],
  ['Otros', /AMAZON|BAZAR|YVES ROCHER|PERFUMERIA|ALIEXPRESS|EL CORTE INGLES|MEDIA MARKT|WALLAPOP|\bEBAY\b|PC COMPONENTES|MIRAVIA|\bTEMU\b|SPRAYGROUND|BRICO|HOGAR|PAYPAL/],
  ['Donaciones', /DONATIVOS?|DONACION|CARITAS?|CRUZ ROJA|ONG\b|SOLIDARIDAD|HELPAGE|UNICEF|MEDICOS SIN FRONTERAS|SAVE THE CHILDREN|INTERSOS|REDOPOS|TEEPEE|FAVILA|CÁRITAS|ANIMALEJOS|ADOPTA UN ABUELO|WWF/],
  ['Trabajo', /\bAWS\b|\bCLOUDFLARE\b|\bESCROW\b/],
];

export function guessExpenseCategory(concept: string): ExpenseCategory {
  const t = concept.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(t)) return category;
  }
  return 'Otros';
}

// ---------------------------------------------------------------------------
// Categorización por concepto aprendido
// ---------------------------------------------------------------------------

const DATE_PREFIX_RE = /^(FECHA DE OPERACION|FECHA VALOR):\s*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s*/i;

/**
 * Normaliza un concepto eliminando el prefijo de fecha inicial (p. ej.
 * «Fecha de operación: 09-12-2025») para poder comparar el comercio real
 * entre movimientos del mismo origen pero fechas distintas.
 */
export function cleanConcept(concept: string): string {
  return (concept ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(DATE_PREFIX_RE, '')
    .trim()
    .toUpperCase();
}

/**
 * Construye un mapa concepto-limpio → categoría a partir de los movimientos
 * existentes. Las categorías editadas manualmente (categoryAuto === false)
 * tienen prioridad; el resto se rellena con el primer valor encontrado.
 * Los movimientos Otros o excluidos no aportan aprendizaje.
 */
export function buildConceptCategoryMap(movements: Movement[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of movements) {
    const cat = m.category;
    if (
      !cat ||
      cat === 'Otros' ||
      cat === 'Excluido'
    )
      continue;
    const key = cleanConcept(m.concept);
    if (!key) continue;
    if (m.categoryAuto === false) map.set(key, cat);
    else if (!map.has(key)) map.set(key, cat);
  }
  return map;
}

/**
 * Resuelve la categoría de un concepto: primero consulta el mapa aprendido de
 * conceptos existentes y, si no hay coincidencia, aplica las palabras clave.
 */
export function resolveExpenseCategory(
  concept: string,
  movements: Movement[],
  fallback: ExpenseCategory = guessExpenseCategory(concept),
): string {
  const learned = buildConceptCategoryMap(movements).get(cleanConcept(concept));
  return learned ?? fallback;
}

export interface CategoryTotal {
  category: ExpenseCategory | string;
  total: number;
  pct: number;
  averageMonthly: number;
  firstDate: string;
  lastMonth: number;
  /** Aportación de cada integrante a la categoría (solo vista conjunta). */
  byMember?: CategoryMemberTotal[];
}

export interface CategoryMemberTotal {
  profileId: string;
  name: string;
  color: string;
  total: number;
  averageMonthly: number;
}

export interface ExpensesSummary {
  total: number;
  monthly: MonthPoint[];
  /** Gasto mensual desglosado por categoría: categoría → serie mensual. */
  monthlyByCategory: Record<string, MonthPoint[]>;
  averageMonthly: number;
  /** Mediana del gasto mensual (meses terminados). */
  medianMonthly: number;
  monthCount: number;
  currentMonth: number;
  previousMonth: number;
  byCategory: CategoryTotal[];
}

const EXCLUDED_CATEGORY = 'Excluido';

function categoryMonthsSince(firstDate: string): number {
  const first = new Date(`${firstDate}T00:00:00`);
  if (Number.isNaN(first.getTime())) return 1;
  // Se cuenta hasta el último mes ya terminado (el mes en curso se excluye).
  const anchor = new Date(new Date().getFullYear(), new Date().getMonth(), 0);
  const months =
    (anchor.getFullYear() - first.getFullYear()) * 12 +
    (anchor.getMonth() - first.getMonth()) +
    (anchor.getDate() >= first.getDate() ? 1 : 0);
  return Math.max(1, months);
}

export function computeExpenses(expenseMovements: Movement[]): ExpensesSummary {
  const counted = expenseMovements.filter(m => (m.category ?? 'Otros') !== EXCLUDED_CATEGORY);

  // Las devoluciones (tipo «refund») restan del sumatorio de gastos: son
  // reversiones de gastos previos, y se restan en la categoría a la que se
  // asignen (p. ej. una devolución de Ropa rebaja los gastos de Ropa).
  const signedAbs = (m: Movement) => (m.type === 'refund' ? -1 : 1) * Math.abs(m.amount);

  const monthlyTotal = new Map<string, number>();
  for (const m of counted) {
    const month = m.date.slice(0, 7);
    monthlyTotal.set(month, (monthlyTotal.get(month) ?? 0) + signedAbs(m));
  }
  const monthly: MonthPoint[] = [...monthlyTotal.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const total = monthly.reduce((sum, p) => sum + p.total, 0);
  const completed = completedMonths(monthly);
  const span = monthSpan(completed);
  const completedTotal = completed.reduce((sum, p) => sum + p.total, 0);

  const now = new Date();
  const current = currentMonthKey();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

  const catTotals = new Map<string, { total: number; firstDate: string; lastMonth: number }>();
  for (const m of counted) {
    const cat = m.category ?? 'Otros';
    const inCurrent = m.date.startsWith(current);
    const entry = catTotals.get(cat) ?? { total: 0, firstDate: m.date, lastMonth: 0 };
    entry.total += signedAbs(m);
    if (inCurrent) entry.lastMonth += signedAbs(m);
    if (m.date < entry.firstDate) entry.firstDate = m.date;
    catTotals.set(cat, entry);
  }
  // El porcentaje de cada categoría se calcula sobre el gasto bruto (suma de
  // las categorías con gasto neto positivo), ignorando las categorías donde las
  // devoluciones superan a los gastos (neto negativo). Así los porcentajes de
  // las categorías que sí suponen gasto suman 100% y no se inflan al restar
  // devoluciones del denominador.
  const grossByCat = [...catTotals.values()].reduce((sum, e) => sum + Math.max(e.total, 0), 0);
  const byCategory: CategoryTotal[] = [...catTotals.entries()]
    .map(([category, { total: catTotal, firstDate, lastMonth }]) => {
      const months = categoryMonthsSince(firstDate);
      return {
        category,
        total: catTotal,
        pct: grossByCat > 0 ? (Math.max(catTotal, 0) / grossByCat) * 100 : 0,
        averageMonthly: months > 0 ? catTotal / months : catTotal,
        firstDate,
        lastMonth,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Serie mensual por categoría para poder filtrar la gráfica por categoría.
  const byCatMovements = new Map<string, Movement[]>();
  for (const m of counted) {
    const cat = m.category ?? 'Otros';
    if (!byCatMovements.has(cat)) byCatMovements.set(cat, []);
    byCatMovements.get(cat)!.push(m);
  }
  const monthlyByCategory: Record<string, MonthPoint[]> = {};
  for (const [cat, movs] of byCatMovements) {
    const catTotalsByMonth = new Map<string, number>();
    for (const m of movs) {
      const month = m.date.slice(0, 7);
      catTotalsByMonth.set(month, (catTotalsByMonth.get(month) ?? 0) + signedAbs(m));
    }
    monthlyByCategory[cat] = [...catTotalsByMonth.entries()]
      .map(([month, monthTotal]) => ({ month, total: monthTotal }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  return {
    total,
    monthly,
    monthlyByCategory,
    averageMonthly: span > 0 ? completedTotal / span : 0,
    medianMonthly: median(completed.map(p => p.total)),
    monthCount: span,
    currentMonth: counted
      .filter(m => m.date.startsWith(current))
      .reduce((sum, m) => sum + signedAbs(m), 0),
    previousMonth: counted
      .filter(m => m.date.startsWith(previousMonthKey))
      .reduce((sum, m) => sum + signedAbs(m), 0),
    byCategory,
  };
}

// ---------------------------------------------------------------------------
// Ingresos
// ---------------------------------------------------------------------------

export interface IncomeSummary {
  total: number;
  monthly: MonthPoint[];
  /** Media mensual de ingresos en todo el histórico. */
  averageMonthly: number;
  monthCount: number;
  currentMonth: number;
  previousMonth: number;
}

export function computeIncome(incomeMovements: Movement[]): IncomeSummary {
  const monthlyTotal = new Map<string, number>();
  for (const m of incomeMovements) {
    const month = m.date.slice(0, 7);
    monthlyTotal.set(month, (monthlyTotal.get(month) ?? 0) + Math.abs(m.amount));
  }
  const monthly: MonthPoint[] = [...monthlyTotal.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const total = monthly.reduce((sum, p) => sum + p.total, 0);
  const completed = completedMonths(monthly);
  const span = monthSpan(completed);
  const completedTotal = completed.reduce((sum, p) => sum + p.total, 0);

  const now = new Date();
  const current = currentMonthKey();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

  return {
    total,
    monthly,
    averageMonthly: span > 0 ? completedTotal / span : 0,
    monthCount: span,
    currentMonth: incomeMovements
      .filter(m => m.date.startsWith(current))
      .reduce((sum, m) => sum + Math.abs(m.amount), 0),
    previousMonth: incomeMovements
      .filter(m => m.date.startsWith(previousMonthKey))
      .reduce((sum, m) => sum + Math.abs(m.amount), 0),
  };
}

// ---------------------------------------------------------------------------
// Serie diaria
// ---------------------------------------------------------------------------

/** Días (YYYY-MM-DD) de un mes, en orden. */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

/** Meses calendario entre fromMonth y toMonth (ambos inclusivos). */
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i <= (ty - fy) * 12 + (tm - fm); i++) {
    const d = new Date(Date.UTC(fy, fm - 1 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Media de una serie mensual dentro de [fromMonth, toMonth] (meses incluidos),
 *  contando con 0 los meses sin actividad (mismo criterio que el resto de
 *  medias de la app). */
export function averageInRange(
  series: Array<{ month: string; total: number }>,
  fromMonth: string,
  toMonth: string,
): number {
  const byMonth = new Map(series.map(p => [p.month, p.total]));
  const months = monthsBetween(fromMonth, toMonth);
  let sum = 0;
  for (const key of months) sum += byMonth.get(key) ?? 0;
  return months.length > 0 ? sum / months.length : 0;
}

/** Etiqueta corta de un día (p. ej. «05 ene»). */
export function formatDay(date: string): string {
  const iso = date.length === 10 ? date : `${date}-01`;
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

export interface DailyPoint {
  date: string;
  income: number;
  expenses: number;
  savings: number;
}

export const DAY_FILTER = /^\d{4}-\d{2}-\d{2}$/;

/** Mes de un valor de filtro (puede ser «YYYY-MM» o «YYYY-MM-DD»). */
export function rangeMonth(value: string): string {
  return value.slice(0, 7);
}

/** Día inicial efectivo de un filtro: un mes se abre en su día 1. */
export function rangeFromDay(value: string): string {
  return DAY_FILTER.test(value) ? value : `${value}-01`;
}

/** Día final efectivo de un filtro: un mes se cierra en su último día. */
export function rangeToDay(value: string): string {
  if (DAY_FILTER.test(value)) return value;
  const days = daysOfMonth(value);
  return days[days.length - 1];
}

/** Serie diaria de un mes (todos los días, rellenando con 0) replicando las
 *  reglas de computeIncome (los ingresos suman su valor absoluto) y de
 *  computeExpenses (los gastos suman, las devoluciones restan y se excluye la
 *  categoría «Excluido»). Si se pasa `category`, solo cuentan los gastos de esa
 *  categoría (devoluciones incluidas, restadas). */
export function computeDailySeries(
  month: string,
  incomeMovements: Movement[],
  expenseMovements: Movement[],
  category: string | null = null,
): DailyPoint[] {
  const incomeByDay = new Map<string, number>();
  for (const m of incomeMovements) {
    if (m.date.startsWith(month)) {
      incomeByDay.set(m.date, (incomeByDay.get(m.date) ?? 0) + Math.abs(m.amount));
    }
  }
  const expensesByDay = new Map<string, number>();
  for (const m of expenseMovements) {
    if (!m.date.startsWith(month)) continue;
    if (category ? (m.category ?? 'Otros') !== category : (m.category ?? 'Otros') === EXCLUDED_CATEGORY) continue;
    const value = (m.type === 'refund' ? -1 : 1) * Math.abs(m.amount);
    expensesByDay.set(m.date, (expensesByDay.get(m.date) ?? 0) + value);
  }
  return daysOfMonth(month).map(date => {
    const income = incomeByDay.get(date) ?? 0;
    const expenses = expensesByDay.get(date) ?? 0;
    return { date, income, expenses, savings: income - expenses };
  });
}
