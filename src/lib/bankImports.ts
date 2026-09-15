import * as XLSX from 'xlsx';

export type BankId = 'trade-republic' | 'myinvestor' | 'caixabank' | 'santander' | 'paypal' | 'revolut';

export const BANKS: ReadonlyArray<{ id: BankId; label: string; hint: string }> = [
  { id: 'trade-republic', label: 'Trade Republic', hint: 'CSV exportado por Trade Republic con datetime, type, name, shares, price, amount…' },
  { id: 'myinvestor', label: 'MyInvestor', hint: 'Movimientos de cuenta (CSV obtenido de MyInvestor) o de fondos (XLS exportado por Inversis)' },
  { id: 'caixabank', label: 'CaixaBank', hint: 'XLS/CSV exportado por CaixaBank con fechas, concepto o movimiento, importe y saldo' },
  { id: 'santander', label: 'Santander', hint: 'XLS/XLSX exportado por Santander con fecha operación, fecha valor, concepto, importe y saldo' },
  { id: 'paypal', label: 'PayPal', hint: 'CSV exportado por PayPal con fecha, hora, descripción, nombre, bruto/comisión/neto y saldo' },
  { id: 'revolut', label: 'Revolut', hint: 'CSV exportado por Revolut con tipo, producto, fechas, descripción, importe, comisión, divisa y saldo' },
];

export type MovementType =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'interest'
  | 'transfer'
  | 'withdrawal'
  | 'fee'
  | 'tax'
  | 'expense'
  | 'income'
  | 'perk'
  | 'refund'
  | 'other';

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  buy: 'Compra',
  sell: 'Venta',
  dividend: 'Dividendo',
  interest: 'Intereses',
  transfer: 'Traspaso',
  withdrawal: 'Retirada',
  fee: 'Comisión',
  tax: 'Impuestos',
  expense: 'Gasto',
  income: 'Sueldo',
  perk: 'Promo',
  refund: 'Devolución',
  other: 'Otro',
};

export interface Movement {
  id: string;
  fileId: string;
  bank: BankId;
  date: string;
  /** Fecha y hora de ejecución (precisión de minuto) cuando el banco la aporta. */
  datetime?: string;
  type: MovementType;
  concept: string;
  amount: number;
  ticker?: string;
  isin?: string;
  shares?: number;
  price?: number;
  /** Comisión cobrada aparte; en datos normalizados vale undefined (va como movimiento propio). */
  fee?: number;
  tax?: number;
  assetClass?: string;
  category?: string;
  /** Partes de un gasto repartido entre categorías y propiedades distintas. */
  expenseSplits?: ExpenseSplit[];
  /**
   * Indica que la categoría fue asignada automáticamente (guessed) en lugar de
   * editada por el usuario. Permite recalcularla al arrancar cuando cambian las
   * reglas, sin pisar ediciones manuales. `true` = auto; `false` = editada.
   */
  categoryAuto?: boolean;
  /** Id del movimiento padre (p. ej. la compra/venta a la que pertenece una comisión). */
  referenceId?: string;
  balance?: number;
  /**
   * Marca movimientos que son operaciones de fondos (suscripciones, reembolsos,
   * traspasos internos) y que NO deben afectar al saldo de caja porque el
   * movimiento de efectivo ya está registrado en el fichero de cuenta.
   */
  fundOperation?: boolean;
  /**
   * Indica si el gasto es conjunto (true) o individual (false).
   * Cuando `isJointAuto !== false`, este valor se hereda de la categoría.
   * Cuando `isJointAuto === false`, este valor fue sobreescrito por el usuario.
   */
  isJoint?: boolean;
  /**
   * Indica si el tipo de cargo (conjunto/individual) está heredado de la
   * categoría (`true`/`undefined`) o fue sobreescrito manualmente (`false`).
   */
  isJointAuto?: boolean;
}

export interface ExpenseSplit {
  category: string;
  /** Importe absoluto de esta parte. La suma debe coincidir con el gasto origen. */
  amount: number;
  /** Propiedad de esta parte. Ausente: hereda propiedad del gasto origen. */
  isJoint?: boolean;
}

export interface FileMeta {
  id: string;
  name: string;
  bank: BankId;
  count: number;
  importedAt: string;
}

export interface ParsedBankFile {
  movements: Movement[];
  skipped: number;
}

export type CellMatrix = string[][];

const ISIN_REGEX = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

function norm(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function extractIsin(text: string): string | undefined {
  const match = String(text).match(/\b([A-Z]{2}[A-Z0-9]{9}\d)\b/);
  return match ? match[1] : undefined;
}

export function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function parseNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  let s = String(raw).trim();
  if (!s || /^(-+|n\/a|null|nan)$/i.test(s)) return undefined;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s.replace(/[^\d\s-]/g, '')) && !/^-/.test(s.trim())) {
    negative = true;
  }
  if (/^\s*-/.test(s)) negative = true;

  s = s.replace(/[^\d.,]/g, '');
  if (!s || !/\d/.test(s)) return undefined;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Solo coma (sin punto). Si la coma va seguida de exactamente 3 dígitos
    // al final (p. ej. 1,234) es separador de millar; en cualquier otro caso
    // (1234,56 / 1234,5 / 1234,567) tratamos coma como decimal.
    if (/,\d{3}$/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/,/g, '.');
    }
  } else if (hasDot && /^-?\d{1,3}(\.\d{3}){2,}$|^-?\d{4,}\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, '');
  }

  const n = Number.parseFloat(s);
  if (Number.isNaN(n)) return undefined;
  return negative ? -n : n;
}

export function parseDateToISO(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim();
  if (!s || !/\d/.test(s)) return undefined;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    // Si el segundo número > 12, el formato es M/D (mes primero, p. ej. Inversis)
    if (Number(b) > 12) [a, b] = [b, a];
    return `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  }

  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000 && /^\d+(\.\d+)?$/.test(s)) {
    const ms = Math.round((serial - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return undefined;
}

/**
 * Normaliza un datetime del banco (p. ej. «2024-07-15T08:16:32.680Z» o
 * «2024-03-05 14:32») a «YYYY-MM-DDTHH:mm». Se usa para agrupar ejecuciones
 * fragmentadas del mismo instante.
 */
export function parseDateTimeToMinute(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim();
  if (!s || !/\d/.test(s)) return undefined;

  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T\s](\d{1,2}):(\d{2})/);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}`;
  }

  if (!/\d{1,2}:\d{2}/.test(s)) return undefined;
  const parsed = new Date(s.includes('T') ? s : s.replace(/\s+/, 'T'));
  if (!Number.isNaN(parsed.getTime())) {
    const iso = parsed.toISOString();
    return `${iso.slice(0, 10)}T${iso.slice(11, 16)}`;
  }

  return undefined;
}

function splitLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function sniffDelimiter(line: string): string {
  const candidates = [';', '\t', ','];
  let best = ';';
  let bestCount = -1;
  for (const d of candidates) {
    const count = splitLine(line, d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  // Si ";" produce ≥3 celdas, siempre preferirlo sobre "," / tab: el punto
  // y coma aparece极少 en valores de datos, mientras que la coma es muy
  // común como separador decimal en formatos europeos (0,50 → 0.50).
  if (best === ',' || best === '\t') {
    const semiCount = splitLine(line, ';').length;
    if (semiCount >= 3) return ';';
  }
  return best;
}

export function parseDelimited(text: string, delimiter?: string): CellMatrix {
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const delim = delimiter ?? sniffDelimiter(lines[0]);
  return lines.map(line => splitLine(line, delim));
}

/**
 * Limpia artefactos HTML y caracteres corruptos que aparecen en ficheros XLS
 * exportados desde MyInvestor (Inversis). Convierte p. ej.
 *   "Fecha operaci󮼯th>Fecha valor" → "Fecha operaciFecha valor"
 */
function cleanCellText(s: string): string {
  return s
    .replace(/[\uD800-\uDFFF]/g, '')                     // surrogate chars (pares y sueltos)
    .replace(/<[^>]*>/g, '')                              // etiquetas HTML
    .replace(/th>/gi, '')                                 // restos de <th> (sin \b: i de "operaci" impide el boundary)
    .replace(/td>/gi, '')                                 // restos de <td>
    .trim();
}

/**
 * Convierte un serial de Excel (días desde 1900) a ISO «YYYY-MM-DD».
 * Excel usa el sistema 1900 con el bug del año bisiesto ficticio,
 * por lo que para fechas >= 1-mar-1900 el serial es exactamente el
 * número de días desde 30-dic-1899.
 */
function excelSerialToISO(serial: number): string | undefined {
  // Solo fechas razonables: 1-ene-1901 (serial 367) a 31-dic-2100 (serial 73413)
  if (serial < 367 || serial > 73413) return undefined;
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function matrixFromWorkbook(wb: XLSX.WorkBook): CellMatrix {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const matrix: CellMatrix = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (cell) {
        if (cell.z && /[dmy]/i.test(cell.z) && typeof cell.v === 'number') {
          const iso = excelSerialToISO(cell.v);
          row.push(iso ?? String(cell.v));
        } else {
          row.push(cleanCellText(String(cell.v ?? '')));
        }
      } else {
        row.push('');
      }
    }
    matrix.push(row);
  }
  return matrix;
}

function decodeBuffer(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('windows-1252').decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return utf8;
  }
}

export async function readFileAsMatrix(file: File): Promise<CellMatrix> {
  const buf = await file.arrayBuffer();
  const name = file.name.toLowerCase();

  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    try {
      return matrixFromWorkbook(XLSX.read(buf, { type: 'array', raw: true }));
    } catch {
      const text = decodeBuffer(buf);
      try {
        return matrixFromWorkbook(XLSX.read(text, { type: 'string', raw: true }));
      } catch {
        return parseDelimited(text);
      }
    }
  }

  return parseDelimited(decodeBuffer(buf));
}

function firstHeaderIndex(matrix: CellMatrix, predicate: (cell: string) => boolean): number {
  return matrix.findIndex(row => row.some(cell => predicate(norm(cell))));
}

function findColumn(header: string[], predicate: (cellNorm: string) => boolean, startAt = 0): number {
  for (let i = startAt; i < header.length; i++) {
    if (predicate(norm(header[i]))) return i;
  }
  return -1;
}

function movementId(bank: BankId, date: string, type: MovementType, concept: string, amount: number, extra: string): string {
  return hashId(`${bank}|${date}|${type}|${concept}|${amount.toFixed(4)}|${extra}`);
}

/**
 * Firma canónica de un movimiento, independiente del fichero o de la posición
 * de la fila. Dos movimientos con la misma firma son el mismo movimiento
 * aunque vengan de exportaciones distintas (p. ej. históricos solapados).
 */
export function movementSignature(m: Movement): string {
  const conceptKey = m.concept.replace(/\s+/g, ' ').trim();
  return [
    m.bank,
    m.date,
    m.type,
    conceptKey,
    m.amount.toFixed(4),
    m.shares ?? '',
    m.ticker ?? '',
    m.isin ?? '',
    m.referenceId ?? '',
    m.balance ?? '',
  ].join('|');
}

/** Elimina duplicados conservando el primer ejemplar (mantiene categorías editadas). */
export function dedupeMovements(movements: Movement[]): Movement[] {
  const seen = new Set<string>();
  const out: Movement[] = [];
  for (const m of movements) {
    const key = movementSignature(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

// Se busca «PAYPAL» como subcadena (no solo como palabra): los cargos del
// banco suelen venir facturados por la entidad legal de PayPal, p. ej.
// «COREPayPal Europe S.a.r.l.», donde «PayPal» va incrustado en el nombre.
const PAYPAL_CONCEPT_RE = /PAYPAL/i;

/**
 * Máxima diferencia de días permitida entre el movimiento de PayPal y el cargo
 * homólogo del banco para considerarlos el mismo. El banco suele contabilizar
 * el cargo días después de la operación PayPal (en la práctica hasta 15 días).
 */
const PAYPAL_DUP_DATE_WINDOW_DAYS = 15;

/** Diferencia en días (valor absoluto) entre dos fechas ISO «YYYY-MM-DD». */
function dateDiffDays(isoA: string, isoB: string): number {
  const a = new Date(`${isoA}T00:00:00`).getTime();
  const b = new Date(`${isoB}T00:00:00`).getTime();
  return Math.abs(a - b) / 86400000;
}

// Palabras que no aportan identidad de comercio y se ignoran al comparar
// conceptos (p. ej. PayPal, Pago exprés, COMPRA, TRX…), para que solo cuente
// un token distintivo (idealmente el nombre del comercio).
const MERCHANT_STOPWORDS = new Set([
  'PAYPAL', 'PAGO', 'EXPRES', 'EXPRESS', 'COMPRA', 'PURCHASE', 'PAYMENT',
  'TRX', 'TXN', 'TRANS', 'REF', 'CON', 'DE', 'EN', 'COM', 'A',
  'MOVIMIENTO', 'OPERACION', 'ABONO', 'CARGO', 'REEMBOLSO', 'DEVOLUCION',
]);

/** Extrae los tokens distintivos del concepto (nombres de comercio) ya
 *  normalizados (mayúsculas, sin acentos), filtrando palabras banales. */
function merchantTokens(concept: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of norm(concept).split(/[^A-Z0-9]+/)) {
    const t = raw.replace(/\.+$/, '');
    if (t.length >= 3 && !MERCHANT_STOPWORDS.has(t) && !/^\d+$/.test(t)) tokens.add(t);
  }
  return tokens;
}

/**
 * Devuelve los ids de los movimientos de otras cuentas bancarias
 * (CaixaBank/Santander, etc.) que duplican un cargo de PayPal: cargos que
 * coinciden en cuantía (importe absoluto) y en fecha (ventana de ±4 días) con
 * un movimiento de PayPal y cuyo concepto es claramente el mismo comercio
 * (contiene «PayPal», o comparte el nombre del comercio con el de PayPal).
 * Estos movimientos se reclasifican de forma derivada como «Traspaso» (no se
 * borran del almacén): si el fichero de PayPal se elimina, el cargo del banco
 * vuelve a su tipo original (Gasto). Los movimientos de PayPal nunca se marcan.
 */
export function paypalDuplicateIds(movements: Movement[]): Set<string> {
  interface PaypalHit {
    date: string;
    tokens: Set<string>;
  }
  const paypalByAmount = new Map<string, PaypalHit[]>();
  for (const m of movements) {
    if (m.bank !== 'paypal') continue;
    const key = Math.abs(m.amount).toFixed(4);
    const hits = paypalByAmount.get(key) ?? [];
    hits.push({ date: m.date, tokens: merchantTokens(m.concept) });
    paypalByAmount.set(key, hits);
  }
  if (paypalByAmount.size === 0) return new Set();
  const hidden = new Set<string>();
  for (const m of movements) {
    if (m.bank === 'paypal') continue;
    const hits = paypalByAmount.get(Math.abs(m.amount).toFixed(4));
    if (!hits) continue;
    const bankTokens = merchantTokens(m.concept);
    const matches =
      PAYPAL_CONCEPT_RE.test(m.concept) ||
      [...bankTokens].some(bt => hits.some(h => h.tokens.has(bt)));
    if (!matches) continue;
    if (hits.some(h => dateDiffDays(h.date, m.date) <= PAYPAL_DUP_DATE_WINDOW_DAYS)) {
      hidden.add(m.id);
    }
  }
  return hidden;
}

/**
 * Reclasifica de forma derivada como «Traspaso» los cargos de otras cuentas que
 * duplican un movimiento de PayPal (mismo importe y dentro de la ventana de
 * fechas). El tipo se sobrescribe sin tocar el almacén, así que si se elimina
 * el fichero de PayPal esos movimientos vuelven a su tipo original (Gasto)
 * automáticamente. Todas las vistas (individual y conjunta) deben usar esta
 * misma derivación para que las cifras mensuales coincidan.
 */
export function reclassifyPaypalDuplicates(movements: Movement[]): Movement[] {
  if (!movements.some(m => m.bank === 'paypal')) return movements;
  const transfers = paypalDuplicateIds(movements);
  if (transfers.size === 0) return movements;
  return movements.map(m => (transfers.has(m.id) ? { ...m, type: 'transfer' as const } : m));
}

// ---------------------------------------------------------------------------
// Órdenes fragmentadas (Trade Republic parte una orden en dos filas)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Órdenes fragmentadas (Trade Republic parte una orden en dos filas)
// ---------------------------------------------------------------------------

function splitTradeKey(m: Movement): string {
  const instrument = (m.isin ?? m.ticker ?? norm(m.concept)).toUpperCase();
  // Con hora se agrupa por minuto exacto; sin ella (datos antiguos), por día.
  const bucket = m.datetime ? m.datetime.slice(0, 16) : m.date;
  return `${m.bank}|${m.type}|${bucket}|${instrument}`;
}

/** ¿Mezcla de filas con participaciones enteras y decimales? Patrón típico de la división en 2. */
function hasSplitSharesPattern(group: Movement[]): boolean {
  const shares = group.map(m => Math.abs(m.shares ?? 0)).filter(s => s > 0);
  if (shares.length < 2) return false;
  const hasInteger = shares.some(s => Math.abs(s - Math.round(s)) < 1e-6);
  const hasFractional = shares.some(s => Math.abs(s - Math.round(s)) >= 1e-6);
  return hasInteger && hasFractional;
}

function mergeTradeGroup(group: Movement[]): Movement {
  const ordered = [...group].sort((a, b) =>
    (a.datetime ?? a.date).localeCompare(b.datetime ?? b.date)
  );
  const head = ordered[0];
  const signedShares = ordered.reduce((sum, m) => sum + (m.shares ?? 0), 0);
  const amount = ordered.reduce((sum, m) => sum + m.amount, 0);
  const fee = ordered.reduce((sum, m) => sum + Math.abs(m.fee ?? 0), 0);
  const tax = ordered.reduce((sum, m) => sum + Math.abs(m.tax ?? 0), 0);
  const merged: Movement = {
    ...head,
    date: ordered.reduce((min, m) => (m.date < min ? m.date : min), head.date),
    shares: signedShares !== 0 ? signedShares : head.shares,
    amount,
    price:
      signedShares !== 0 && amount !== 0 ? Math.abs(amount) / Math.abs(signedShares) : head.price,
    fee: fee > 0 ? fee : undefined,
    tax: tax > 0 ? tax : undefined,
    balance: undefined,
  };
  merged.id = hashId(movementSignature(merged));
  return merged;
}

/**
 * Agrupa órdenes (compras y ventas) del mismo producto ejecutadas en el mismo
 * instante porque el banco las parte en varias filas (Trade Republic emite una
 * fila con nº entero de participaciones y otra con el resto decimal). Con
 * datetime se agrupa por minuto exacto; para movimientos antiguos sin hora se
 * exige además el patrón entero+decimal sobre la misma jornada, para no
 * fusionar órdenes legítimas.
 */
export function mergeSplitTrades(movements: Movement[]): Movement[] {
  const groups = new Map<string, Movement[]>();
  for (const m of movements) {
    if (m.type !== 'buy' && m.type !== 'sell') continue;
    const key = splitTradeKey(m);
    const group = groups.get(key);
    if (group) group.push(m);
    else groups.set(key, [m]);
  }

  const mergedByKey = new Map<string, Movement | null>();
  for (const [key, group] of groups) {
    const mergeable = group.length >= 2 && (group[0].datetime || hasSplitSharesPattern(group));
    mergedByKey.set(key, mergeable ? mergeTradeGroup(group) : null);
  }

  // Conserva el orden original emitiendo cada grupo fusionado en su primera posición.
  const out: Movement[] = [];
  const emitted = new Set<string>();
  for (const m of movements) {
    if (m.type !== 'buy' && m.type !== 'sell') {
      out.push(m);
      continue;
    }
    const key = splitTradeKey(m);
    const replacement = mergedByKey.get(key);
    if (!replacement) {
      out.push(m);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    out.push(replacement);
  }
  return out;
}

/**
 * Reclasifica ingresos guardados antes de que STOCKPERK tuviera tipo propio:
 * un abono de Trade Republic vinculado a un valor concreto y sin
 * participaciones es una acción regalada (perk), no un ingreso del usuario.
 * Los ingresos reales (nóminas, recargas Google Pay, devoluciones…) no llevan
 * ticker/ISIN, así que no se ven afectados.
 */
export function reclassifyStockPerkIncome(movements: Movement[]): Movement[] {
  return movements.map(m =>
    m.bank === 'trade-republic' && m.type === 'income' && (m.isin || m.ticker) && m.shares === undefined
      ? { ...m, type: 'perk' as const }
      : m
  );

}

/**
 * Separa la comisión de cada compra/venta en un movimiento propio de tipo
 * «comisión» vinculado a su orden mediante referenceId. Así el importe y el
 * precio medio de la operación nunca incluyen comisiones: son participaciones
 * × precio, y la comisión aparece como fila independiente (importe negativo).
 */
export function splitTradeFees(movements: Movement[]): Movement[] {
  const out: Movement[] = [];
  for (const m of movements) {
    const fee = Math.abs(m.fee ?? 0);
    if ((m.type !== 'buy' && m.type !== 'sell') || !(fee > 1e-9)) {
      out.push(m);
      continue;
    }
    const feeMovement: Movement = {
      id: '',
      fileId: m.fileId,
      bank: m.bank,
      date: m.date,
      datetime: m.datetime,
      type: 'fee',
      concept: `${m.concept} · Comisión`,
      amount: -fee,
      ticker: m.ticker,
      isin: m.isin,
      assetClass: m.assetClass,
      referenceId: m.id,
    };
    feeMovement.id = hashId(movementSignature(feeMovement));
    out.push({ ...m, fee: undefined }, feeMovement);
  }
  return out;
}

/**
 * Reclasifica movimientos cuyo signo contradice su tipo: un gasto con importe
 * positivo es en realidad una devolución (anulaciones/reversiones de tarjeta)
 * y una devolución con importe negativo es un gasto. Garantiza que los importes
 * positivos que entren en «Gastos» acaben siempre como «Devoluciones».
 */
export function reclassifySignMismatched(movements: Movement[]): Movement[] {
  return movements.map(m => {
    if (m.type === 'expense' && m.amount > 0) return { ...m, type: 'refund' as const };
    if (m.type === 'refund' && m.amount < 0) return { ...m, type: 'expense' as const };
    return m;
  });
}

/**
 * Normalización completa de los movimientos almacenados: reclasifica perks
 * antiguos, fusiona órdenes partidas, separa las comisiones en movimientos
 * propios, corrige el signo de gastos/devoluciones y elimina duplicados
 * (p. ej. los que surgirían al reimportar un fichero con tipos recalibrados).
 */
export function normalizeStoredMovements(movements: Movement[]): Movement[] {
  return dedupeMovements(splitTradeFees(mergeSplitTrades(reclassifyStockPerkIncome(reclassifySignMismatched(movements)))));
}

// ---------------------------------------------------------------------------
// Trade Republic
// ---------------------------------------------------------------------------

function classifyByKeywords(text: string, amount: number): MovementType {
  const t = norm(text);
  if (/COMPRA|\bBUY\b|\bKAUF\b|SPARPLAN|SAVINGS ?_?PLAN/.test(t)) return 'buy';
  if (/VENTA|\bSELL\b|VERKAUF/.test(t)) return 'sell';
  if (/DIVIDEND|UPTEVIA/.test(t)) return 'dividend';
  // Acciones regaladas por promociones (p. ej. STOCKPERK de Trade Republic):
  // no son un ingreso del usuario.
  if (/\bSTOCK[\s_]?PERK\b|\bPERK\b/.test(t)) return 'perk';
  if (/INTERES|ZINS/.test(t)) return 'interest';
  if (/RETENCION|CAPITAL GAINS|IMPUESTO|TRIBUTARIAS|STEUER|(\b|_)TAX(_|\b)/.test(t)) return 'tax';
  if (/COMISION|GEBUHR|(\b|_)FEE(_|\b)/.test(t)) return 'fee';
  if (/DEPOSIT|INGRESO|APORTE|EINZAHLUNG|INBOUND|INPAYMENT/.test(t)) return 'transfer';
  if (/RETIRADA|RETIRO|WITHDRAWAL|AUSZAHLUNG|OUTBOUND|OUTPAYMENT/.test(t)) return 'withdrawal';
  // Devoluciones de compras, dinero prestado devuelto, etc.: ingresos
  // reversiones de gastos (no son nómina ni rentabilidad). Van antes que los
  // pagos con tarjeta para no clasificar un reembolso como gasto.
  if (/DEVOLUCION|DEVOLUCIÓN|REEMBOLSO|REFUND|RESTITUCION|\bREST\.|\bBIZUM RECIBIDO\b/.test(t)) return 'refund';
  if (/TARJETA|(\b|_)CARD(_|\b)|KARTEN?ZAHLUNG/.test(t)) return 'expense';
  if (/TRASPASO|TRANSFER|UEBERWEISUNG|ÜBERWEISUNG/.test(t)) return 'transfer';
  if (/SAVEBACK|CASHBACK|BONUS|PRAMIE/.test(t)) return 'income';
  if (/NOMINA|PENSION|SUELDO|SALARY/.test(t)) return 'income';
  return amount <= 0 ? 'expense' : 'income';
}

export function parseTradeRepublic(matrix: CellMatrix): ParsedBankFile {
  const headerIdx = firstHeaderIndex(matrix, c => c === 'TYPE' || c === 'TIPO');
  if (headerIdx < 0) return { movements: [], skipped: matrix.length };
  const header = matrix[headerIdx].map(c => norm(c));

  const col = {
    datetime: findColumn(header, c => c === 'DATETIME' || c === 'FECHA HORA'),
    date: findColumn(header, c => c === 'DATE' || c.startsWith('FECHA')),
    accountType: findColumn(header, c => c.includes('ACCOUNT')),
    category: findColumn(header, c => c === 'CATEGORY'),
    type: findColumn(header, c => c === 'TYPE' || c === 'TIPO'),
    assetClass: findColumn(header, c => c.includes('ASSET')),
    name: findColumn(header, c => c === 'NAME' || c === 'NOMBRE'),
    symbol: findColumn(header, c => c === 'SYMBOL'),
    shares: findColumn(header, c => c === 'SHARES'),
    price: findColumn(header, c => c === 'PRICE'),
    amount: findColumn(header, c => c === 'AMOUNT' || c === 'IMPORTE'),
    fee: findColumn(header, c => c === 'FEE'),
    tax: findColumn(header, c => c === 'TAX'),
    description: findColumn(header, c => c === 'DESCRIPTION'),
    counterparty: findColumn(header, c => c.includes('COUNTERPARTY')),
    mcc: findColumn(header, c => c.includes('MCC')),
    transactionId: findColumn(header, c => c.includes('TRANSACTION')),
  };

  const movements: Movement[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row.some(c => c.length > 0)) continue;

    const date =
      (col.date >= 0 ? parseDateToISO(row[col.date]) : undefined) ??
      (col.datetime >= 0 ? parseDateToISO(row[col.datetime]) : undefined);
    const amount = col.amount >= 0 ? parseNumber(row[col.amount]) : undefined;
    if (!date || amount === undefined) {
      skipped++;
      continue;
    }
    const datetime = col.datetime >= 0 ? parseDateTimeToMinute(row[col.datetime]) : undefined;

    const rawType = row[col.type] ?? '';
    const categoryText = [
      col.category >= 0 ? row[col.category] : '',
      col.assetClass >= 0 ? row[col.assetClass] : '',
    ].join(' ');
    // El tipo manda; si es genérico o vacío, la categoría/asset_class puede
    // identificar el movimiento (p. ej. abonos de interés de la cuenta remunerada).
    const type = classifyByKeywords(`${rawType} ${categoryText}`, amount);
    const name = (col.name >= 0 ? row[col.name] : '') || '';
    const description = (col.description >= 0 ? row[col.description] : '') || '';
    const counterparty = (col.counterparty >= 0 ? row[col.counterparty] : '') || '';
    const concept = name || description || counterparty || rawType || 'Movimiento Trade Republic';
    const ticker = (col.symbol >= 0 ? row[col.symbol] : '') || undefined;
    const isin = extractIsin(`${name} ${description}`) ?? extractIsin(counterparty);
    const shares = col.shares >= 0 ? parseNumber(row[col.shares]) : undefined;
    const price = col.price >= 0 ? parseNumber(row[col.price]) : undefined;
    const fee = col.fee >= 0 ? parseNumber(row[col.fee]) : undefined;
    const tax = col.tax >= 0 ? parseNumber(row[col.tax]) : undefined;
    const mcc = col.mcc >= 0 ? row[col.mcc] : '';
    const transactionId = col.transactionId >= 0 ? row[col.transactionId] : '';
    const assetClass =
      (col.assetClass >= 0 ? row[col.assetClass] : '') ||
      (col.category >= 0 ? row[col.category] : '') ||
      (col.accountType >= 0 ? row[col.accountType] : '');

    movements.push({
      id: movementId('trade-republic', date, type, concept, amount, `${ticker ?? ''}|${shares ?? ''}|${counterparty}|${mcc}|${transactionId}`),
      fileId: '',
      bank: 'trade-republic',
      date,
      datetime,
      type,
      concept,
      amount,
      ticker: ticker || undefined,
      isin,
      shares: shares ?? undefined,
      price: price ?? undefined,
      fee: fee ?? undefined,
      tax: tax ?? undefined,
      assetClass: assetClass || undefined,
      referenceId: transactionId || undefined,
    });
  }

  return { movements, skipped };
}

// ---------------------------------------------------------------------------
// MyInvestor — movimientos de cuenta
// ---------------------------------------------------------------------------

function classifyMyInvestorType(text: string, amount: number): MovementType {
  const t = norm(text);
  if (/TRASPASO/.test(t)) return 'transfer';
  // IIC = Institución de Inversión Colectiva → son suscripciones/redenciones de fondos,
  // que ya se capturan en el fichero de fondos. Clasificar como 'transfer' evita
  // que se contabilicen dos veces (doble conteo de la inversión total).
  if (/IIC/.test(t)) return 'transfer';
  if (/SUSCRIP|COMPRA/.test(t)) return 'buy';
  if (/REEMBOLSO|AMORTIZ|VENTA/.test(t)) return 'sell';
  if (/DIVIDEND|CUPON/.test(t)) return 'dividend';
  // Retenciones/impuestos antes de intereses: «RET. LIQ INTERESES JULIO PROMO»
  // contiene «INTERESES» pero es una retención, no un ingreso por intereses.
  if (/IMPUESTO|RETENCION|\bRETE\b|\bRET\./.test(t)) return 'tax';
  // Promociones negativas son retenciones (p. ej. «PROMOCION AMIGO ANF» con -4.75 €).
  if (/\bPROMOCION\b|^\s*PROMO\b|^\s*BONO\b/.test(t) && amount < 0) return 'tax';
  // Bonos y promociones (p. ej. «PROMOCION AMIGO ANF», «ABONO PROMOCION»)
  // se clasifican como perks antes de intereses/gastos.
  // «PROMOCION» como palabra completa se detecta en cualquier posición
  // (necesario para «ABONO PROMOCION»), mientras que «PROMO» solo al inicio
  // para no confundir con «RET. LIQ INTERESES JULIO PROMO».
  if (/\bPROMOCION\b|^\s*PROMO\b|^\s*BONO\b|STOCKPERK|\bPERK\b/.test(t)) return 'perk';
  // Intereses negativos son retenciones sobre intereses (p. ej. «LIQ INTERESES» con -1.23 €).
  // Debe ir antes del chequeo general de INTERES para no clasificarlos como ingreso.
  if (/INTERES/.test(t) && amount < 0) return 'tax';
  // Intereses: «REGULARIZACION INTERESES», «PERIODO ...»
  if (/INTERES|PERIODO/.test(t)) return 'interest';
  if (/RETIRADA|DISPOSICION/.test(t)) return 'withdrawal';
  if (/IMPOSICION|APORTACION|INGRESO|TRANSFERENCIA/.test(t)) return 'transfer';
  if (/COMISION/.test(t)) return 'fee';
  if (/DEVOLUCION|DEVOLUCIÓN|REEMBOLSO|REFUND|RESTITUCION|BIZUM RECIBIDO/.test(t)) return 'refund';
  if (/TARJETA|RECIBO|PAGO/.test(t)) return 'expense';
  if (/NOMINA|PENSION/.test(t)) return 'income';
  // Fondos: nombres de fondos con patrones típicos (INDEX, ETF, @, etc.)
  // Se clasifican como 'buy' porque el dinero sale de la cuenta, pero
  // computePortfolio los excluye (solo cuenta las operaciones del fichero de fondos).
  if (amount < 0 && /INDEX|INDX|ETF|FUND|ACC|DIST|@|STOCK|MARKET/.test(t)) return 'buy';
  return amount <= 0 ? 'expense' : 'income';
}

/**
 * Detecta columnas del fichero de cuenta MyInvestor inspeccionando las filas
 * de datos: identifica columnas de fecha, texto, divisa e importe por tipo
 * de valor. Se usa como fallback cuando las cabeceras están corruptas o
 * fusionadas (p. ej. XLS exportados desde Inversis/MyInvestor).
 */
function detectAccountColumnsByData(
  matrix: CellMatrix,
  startRow: number,
): { date: number; type: number; concept: number; currency: number; amount: number } | null {
  const samples = matrix.slice(startRow, startRow + 10);
  if (!samples.length) return null;

  const colCount = Math.max(...samples.map(r => r.length));
  const scores: { dates: number; currencies: number; numbers: number; texts: number }[] = [];

  // Heurística estricta para detectar celdas de fecha: solo acepta ISO
  // (YYYY-MM-DD) o formatos con separadores (DD/MM/YY, etc.), no cadenas
  // numéricas simples que `new Date()` convertiría erróneamente a fecha.
  const DATEISH = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/;

  for (let c = 0; c < colCount; c++) {
    const s = { dates: 0, currencies: 0, numbers: 0, texts: 0 };
    for (const row of samples) {
      if (c >= row.length) continue;
      const v = row[c].trim();
      if (!v) continue;
      if (DATEISH.test(v) && parseDateToISO(v)) s.dates++;
      else if (/^(EUR|USD|GBP|CHF)$/i.test(v)) s.currencies++;
      else if (parseNumber(v) !== undefined && !/^[A-Z]/.test(v)) s.numbers++;
      else s.texts++;
    }
    scores.push(s);
  }

  const dateCols = scores.map((s, i) => s.dates > 0 && s.dates >= s.numbers && s.dates >= s.texts ? i : -1).filter(i => i >= 0);
  const currCols = scores.map((s, i) => s.currencies > 0 ? i : -1).filter(i => i >= 0);
  const numCols = scores.map((s, i) => s.numbers > 0 && s.numbers > s.dates && s.numbers > s.texts ? i : -1).filter(i => i >= 0);
  const textCols = scores.map((s, i) => s.texts > 0 && s.texts > s.dates && s.numbers === 0 ? i : -1).filter(i => i >= 0);

  if (dateCols.length < 1 || numCols.length < 1) return null;

  return {
    date: dateCols[0],
    type: textCols[0] ?? -1,
    concept: textCols.length > 1 ? textCols[1] : (textCols[0] ?? -1),
    currency: currCols[0] ?? -1,
    amount: numCols[numCols.length - 1],
  };
}

export function parseMyInvestorAccount(matrix: CellMatrix): ParsedBankFile {
  // 1. Detección estándar por cabecera
  let headerIdx = firstHeaderIndex(
    matrix,
    c => c.includes('FECHA OPERACION') || c.includes('TIPO DE OPERACION') || c === 'CONCEPTO'
  );

  // 2. Fallback: cabecera con artefactos HTML → busca DIVISA / IMPORTE (siempre limpios)
  if (headerIdx < 0) {
    headerIdx = firstHeaderIndex(
      matrix,
      c => c.includes('DIVISA') || c.includes('IMPORTE') || (c.includes('FECHA') && c.includes('OPERACI'))
    );
  }

  if (headerIdx < 0) return { movements: [], skipped: matrix.length };
  const header = matrix[headerIdx].map(c => norm(c));

  let col = {
    date: findColumn(header, c => c.includes('FECHA OPERACION')) >= 0
      ? findColumn(header, c => c.includes('FECHA OPERACION'))
      : findColumn(header, c => c.includes('FECHA')),
    type: findColumn(header, c => c.includes('TIPO DE OPERACION') || c === 'OPERACION'),
    concept: findColumn(header, c => c.includes('CONCEPTO')),
    currency: findColumn(header, c => c.includes('DIVISA')),
    amount: findColumn(header, c => c.includes('IMPORTE')),
  };

  // Si la cabecera tiene celdas fusionadas (menos columnas útiles que datos),
  // detecta por tipos de dato en las filas de datos.
  const headerContentCount = header.filter(c => c.length > 0).length;
  const firstDataRow = matrix.find((row, i) => i > headerIdx && row.some(c => c.trim().length > 0));
  const dataContentCount = firstDataRow?.filter(c => c.trim().length > 0).length ?? 0;
  const hasMergedHeaders = col.type < 0 && headerContentCount < dataContentCount - 1;
  const hasDataCols = col.date >= 0 && col.amount >= 0 && !hasMergedHeaders;
  if (!hasDataCols) {
    const detected = detectAccountColumnsByData(matrix, headerIdx + 1);
    if (detected) col = detected;
    else return { movements: [], skipped: matrix.length };
  }

  const rawMovements: { date: string; rawType: string; conceptRaw: string; amount: number; isin: string | undefined; currency: string }[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row.some(c => c.length > 0)) continue;

    const date = col.date >= 0 ? parseDateToISO(row[col.date]) : undefined;
    const amount = col.amount >= 0 ? parseNumber(row[col.amount]) : undefined;
    if (!date || amount === undefined) {
      skipped++;
      continue;
    }

    const rawType = (col.type >= 0 ? row[col.type] : '') || '';
    const conceptRaw = (col.concept >= 0 ? row[col.concept] : '') || rawType || 'Movimiento MyInvestor';
    const isin = extractIsin(conceptRaw);
    const currency = col.currency >= 0 ? row[col.currency] : '';

    rawMovements.push({ date, rawType, conceptRaw, amount, isin, currency });
  }

  const movements: Movement[] = [];
  for (const rm of rawMovements) {
    const type = classifyMyInvestorType(rm.rawType || rm.conceptRaw, rm.amount);

    movements.push({
      id: movementId('myinvestor', rm.date, type, rm.conceptRaw, rm.amount, `${rm.rawType}|${rm.currency}`),
      fileId: '',
      bank: 'myinvestor',
      date: rm.date,
      type,
      concept: rm.conceptRaw,
      amount: rm.amount,
      isin: rm.isin,
    });
  }

  return { movements, skipped };
}

// ---------------------------------------------------------------------------
// MyInvestor — movimientos de fondos (export Inversis)
// ---------------------------------------------------------------------------

interface InversisColumns {
  isin: number;
  valor: number;
  titulos: number;
  importe: number;
  precio: number;
  mercado: number;
}

function findInversisColumns(headerRow: string[]): InversisColumns | null {
  const isin = headerRow.findIndex(c => norm(c) === 'ISIN' || norm(c).includes(' ISIN') || norm(c).endsWith('ISIN'));
  if (isin < 0) return null;
  return {
    isin,
    valor: findColumn(headerRow, c => c.startsWith('VALOR')),
    titulos: findColumn(headerRow, c => c.includes('TITULO') || c.includes('NOMINAL')),
    importe: findColumn(headerRow, c => c.includes('IMPORTE')),
    precio: findColumn(headerRow, c => c.includes('PRECIO')),
    mercado: findColumn(headerRow, c => c.includes('MERCADO')),
  };
}

/**
 * Detecta columnas del fichero de fondos MyInvestor/Inversis inspeccionando
 * las filas de datos cuando la cabecera está corrupta o desalineada.
 * Busca la columna ISIN por regex y asigna el resto por posición relativa.
 */
function detectFundsColumnsByData(matrix: CellMatrix, headerIdx: number): InversisColumns | null {
  for (let r = headerIdx + 1; r < Math.min(matrix.length, headerIdx + 15); r++) {
    const row = matrix[r];
    for (let c = 0; c < row.length; c++) {
      if (ISIN_REGEX.test((row[c] ?? '').trim().toUpperCase())) {
        const isin = c;
        // Layout típico: [fecOp, fecLiq, nOp, mercado, operacion, ISIN, valor, titulos, divisa, precio, importe]
        return {
          isin,
          mercado: isin >= 2 ? isin - 2 : -1,
          valor: isin + 1,
          titulos: isin + 2,
          precio: isin + 4,
          importe: isin + 5,
        };
      }
    }
  }
  return null;
}

function classifyInversisOperation(text: string, amount: number): MovementType {
  const t = norm(text);
  if (/SUSCR|COMPRA|APORTAC/.test(t)) return 'buy';
  if (/REEMBOLSO|AMORTIZ|VENTA/.test(t)) return 'sell';
  if (/TRASPASO/.test(t)) return 'transfer';
  if (/DIVIDEND|CUPON/.test(t)) return 'dividend';
  if (/FUSION/.test(t)) return 'transfer';
  return amount <= 0 ? 'buy' : 'sell';
}

export function parseMyInvestorFunds(matrix: CellMatrix): ParsedBankFile {
  // Busca la fila de cabecera: primero intenta ISIN exacto, luego includes
  // (necesario cuando las cabeceras traen artefactos HTML tipo "OperacionISIN").
  let headerIdx = matrix.findIndex(row => row.some(c => norm(c) === 'ISIN'));
  if (headerIdx < 0) {
    headerIdx = matrix.findIndex(row => row.some(c => norm(c).includes('ISIN')));
  }
  if (headerIdx < 0) return { movements: [], skipped: matrix.length };

  const combined: string[] = [];
  for (let i = Math.max(0, headerIdx - 1); i <= headerIdx; i++) {
    const row = matrix[i];
    for (let c = 0; c < Math.max(combined.length, row.length); c++) {
      combined[c] = [combined[c], row[c]].filter(Boolean).join(' ');
    }
  }
  const cols = findInversisColumns(combined);

  // Si la detección por cabecera no encontró ISIN o el ISIN apunta a una
  // columna que no contiene códigos ISIN en los datos, detecta por datos.
  const effectiveCols = cols && ISIN_REGEX.test((matrix[headerIdx + 1]?.[cols.isin] ?? '').trim().toUpperCase())
    ? cols
    : detectFundsColumnsByData(matrix, headerIdx);
  if (!effectiveCols) return { movements: [], skipped: matrix.length };

  const movements: Movement[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row.some(c => c.length > 0)) continue;

    let date: string | undefined;
    let dateCol = -1;
    for (let c = 0; c < effectiveCols.isin && c < row.length; c++) {
      const candidate = parseDateToISO(row[c]);
      if (candidate) {
        date = candidate;
        dateCol = c;
        break;
      }
    }
    const importe = effectiveCols.importe >= 0 ? parseNumber(row[effectiveCols.importe]) : undefined;
    if (!date || importe === undefined) {
      skipped++;
      continue;
    }

    const isinValue = (row[effectiveCols.isin] ?? '').toUpperCase().replace(/\s/g, '');
    const isin = ISIN_REGEX.test(isinValue) ? isinValue : undefined;

    let rawOp = '';
    let opCol = -1;
    for (let c = dateCol + 1; c < effectiveCols.isin && c < row.length; c++) {
      const cell = norm(row[c]);
      if (!cell) continue;
      if (c === effectiveCols.mercado) continue;
      if (/SUSCRIP|REEMBOLSO|TRASPASO|DIVIDEND|CUPON|COMPRA|VENTA|AMORTIZ|APORTAC|FUSION/.test(cell)) {
        rawOp = cell;
        opCol = c;
        break;
      }
    }

    const type = classifyInversisOperation(rawOp, importe);
    let name = (effectiveCols.valor >= 0 ? row[effectiveCols.valor] : '') || '';
    if (!name || ISIN_REGEX.test(norm(name)) || /^\s*[-+]?\d[\d.,\s]*$/.test(name)) {
      // busca una descripción textual entre las columnas de fecha y el ISIN
      const descriptive = /[a-záéíóúñ]/i;
      const candidates: string[] = [];
      for (let c = dateCol + 1; c < effectiveCols.isin && c < row.length; c++) {
        if (c === opCol || c === effectiveCols.mercado) continue;
        const v = row[c] ?? '';
        if (v && descriptive.test(v)) candidates.push(v);
      }
      name = candidates[0] ?? isin ?? 'Fondo';
    }
    const mercado = effectiveCols.mercado >= 0 ? row[effectiveCols.mercado] : '';
    const concept = mercado && !name.toLowerCase().includes(mercado.toLowerCase()) ? `${name} (${mercado})` : name;
    const shares = effectiveCols.titulos >= 0 ? parseNumber(row[effectiveCols.titulos]) : undefined;
    const price = effectiveCols.precio >= 0 ? parseNumber(row[effectiveCols.precio]) : undefined;

    movements.push({
      id: movementId('myinvestor', date, type, name, importe, `${isin ?? ''}|${shares ?? ''}|${rawOp}`),
      fileId: '',
      bank: 'myinvestor',
      date,
      type,
      concept,
      amount: importe,
      isin,
      shares: shares ?? undefined,
      price: price ?? undefined,
      assetClass: rawOp || undefined,
      fundOperation: true,
    });
  }

  return { movements, skipped };
}

// ---------------------------------------------------------------------------
// CaixaBank — detección flexible
// ---------------------------------------------------------------------------

// Cabeceras conocidas de los distintos formatos de CaixaBank. Se usa para
// puntuar cada fila y distinguir la cabecera real de las filas de metadatos
// previas («Movimientos de la cuenta», «Importes expresados en euros»…) que
// también contienen alguna palabra clave (p. ej. MOVIMIENTO).
const CAIXA_HEADER_KEYWORDS = [
  'FECHA OPERACION',
  'F. OPERACION',
  'FECHA VALOR',
  'F. VALOR',
  'FECHA CONTABLE',
  'FECHA',
  'CONCEPTO',
  'MOVIMIENTO',
  'MAS DATOS',
  'IMPORTE',
  'INGRESO',
  'GASTO',
  'SALDO',
] as const;

function scoreCaixaHeaderRow(row: string[]): number {
  let score = 0;
  for (const kw of CAIXA_HEADER_KEYWORDS) {
    if (row.some(c => c.includes(kw))) score++;
  }
  return score;
}

export function parseCaixaBank(matrix: CellMatrix): ParsedBankFile {
  // Detección previa: primera fila que empiece por FECHA/F. o contenga
  // CONCEPTO/MOVIMIENTO. Se conserva para no alterar los formatos existentes.
  const legacyIdx = firstHeaderIndex(
    matrix,
    c => c.startsWith('FECHA') || c.startsWith('F.') || c.includes('CONCEPTO') || c.includes('MOVIMIENTO')
  );

  // Escaneo por puntuación: sirve solo si encuentra una cabecera claramente
  // más completa que la de la detección previa (p. ej. cuando el metadato
  // «Movimientos de la cuenta» capturaba el legacyIdx).
  let bestIdx = -1;
  let bestScore = 0;
  for (let r = 0; r < matrix.length; r++) {
    const score = scoreCaixaHeaderRow(matrix[r].map(norm));
    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }
  const legacyScore = legacyIdx >= 0 ? scoreCaixaHeaderRow(matrix[legacyIdx].map(norm)) : 0;
  const headerIdx =
    bestIdx >= 0 && bestScore >= 3 && bestScore > legacyScore ? bestIdx : legacyIdx;
  if (headerIdx < 0) return { movements: [], skipped: matrix.length };
  const header = matrix[headerIdx].map(c => norm(c));

  // Nuevo formato CaixaBank: Ingreso(+)/Gasto(-) en vez de un solo IMPORTE.
  const incomeCol = findColumn(header, c => c.includes('INGRESO'));
  const expenseCol = findColumn(header, c => c.includes('GASTO'));
  const isNewFormat = incomeCol >= 0 && expenseCol >= 0;

  if (isNewFormat) return parseCaixaBankNew(matrix, headerIdx, header, incomeCol, expenseCol);

  return parseCaixaBankLegacy(matrix, headerIdx, header);
}

function parseCaixaBankNew(
  matrix: CellMatrix,
  headerIdx: number,
  header: string[],
  incomeCol: number,
  expenseCol: number,
): ParsedBankFile {
  // Fechas
  const opDateCol = findColumn(header, c => c.includes('F. OPERACION') || c.includes('FECHA OPERACION'));
  const valDateCol = findColumn(header, c => c.includes('F. VALOR') || c.includes('FECHA VALOR'));
  const dateCol = opDateCol >= 0 ? opDateCol : valDateCol;

  // Saldo
  const saldoPosCol = findColumn(header, c => c.includes('SALDO') && c.includes('(+)'));
  const saldoNegCol = findColumn(header, c => c.includes('SALDO') && c.includes('(-)'));
  const balanceCol = saldoPosCol >= 0 ? saldoPosCol : saldoNegCol >= 0 ? saldoNegCol : findColumn(header, c => c.includes('SALDO'));

  // Concepto complementario 1 (descripción principal) y 5 (fallback)
  const comp1Col = findColumn(header, c => c.includes('CONCEPTO COMPLEMENTARIO') && /\b1\b/.test(c));
  const comp5Col = findColumn(header, c => c.includes('CONCEPTO COMPLEMENTARIO') && /\b5\b/.test(c));

  // ISIN: buscar en complementarios
  const isinCols: number[] = [];
  for (let i = 1; i <= 10; i++) {
    const col = findColumn(header, c => c.includes('CONCEPTO COMPLEMENTARIO') && new RegExp(`\\b${i}\\b`).test(c));
    if (col >= 0) isinCols.push(col);
  }

  const movements: Movement[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row.some(c => c.length > 0)) continue;

    const date = dateCol >= 0 ? parseDateToISO(row[dateCol]) : undefined;
    if (!date) { skipped++; continue; }

    const income = incomeCol >= 0 ? parseNumber(row[incomeCol]) : undefined;
    const expense = expenseCol >= 0 ? parseNumber(row[expenseCol]) : undefined;
    const amount = income !== undefined && income !== 0
      ? income
      : expense !== undefined ? -Math.abs(expense) : undefined;
    if (amount === undefined) { skipped++; continue; }

    // Concepto: comp1 → comp5 → vacío
    const concept = (comp1Col >= 0 ? (row[comp1Col] ?? '').trim() : '')
      || (comp5Col >= 0 ? (row[comp5Col] ?? '').trim() : '')
      || 'Movimiento CaixaBank';

    // ISIN
    let isin: string | undefined;
    for (const c of isinCols) {
      const candidate = extractIsin(row[c] ?? '');
      if (candidate) { isin = candidate; break; }
    }

    const type = classifyCaixaBankConcept(concept, amount);

    const balanceRaw = balanceCol >= 0 ? (row[balanceCol] ?? '') : '';
    const balance = parseNumber(balanceRaw);

    movements.push({
      id: movementId('caixabank', date, type, concept, amount, balanceRaw),
      fileId: '',
      bank: 'caixabank',
      date,
      type,
      concept,
      amount,
      isin,
      balance: balance ?? undefined,
    });
  }

  return { movements, skipped };
}

function parseCaixaBankLegacy(matrix: CellMatrix, headerIdx: number, header: string[]): ParsedBankFile {
  const dateCandidates = ['FECHA CONTABLE', 'FECHA VALOR', 'FECHA OPERACION'];
  let dateCol = -1;
  for (const cand of dateCandidates) {
    dateCol = findColumn(header, c => c.includes(cand));
    if (dateCol >= 0) break;
  }
  if (dateCol < 0) dateCol = findColumn(header, c => c.startsWith('FECHA') || c.startsWith('F.'));

  const conceptCol =
    findColumn(header, c => c.includes('CONCEPTO')) >= 0
      ? findColumn(header, c => c.includes('CONCEPTO'))
      : findColumn(header, c => c.includes('MOVIMIENTO') || c.includes('DESCRIPC'));
  const masDatosCol = findColumn(header, c => c.includes('MAS DATOS'));
  const amountCol = findColumn(header, c => c.includes('IMPORTE'));
  const balanceCol = findColumn(header, c => c.includes('SALDO'));

  const movements: Movement[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row.some(c => c.length > 0)) continue;

    const date = dateCol >= 0 ? parseDateToISO(row[dateCol]) : undefined;
    const amount = amountCol >= 0 ? parseNumber(row[amountCol]) : undefined;
    if (!date || amount === undefined) {
      skipped++;
      continue;
    }

    const concept = (conceptCol >= 0 ? row[conceptCol] : '') || (masDatosCol >= 0 ? row[masDatosCol] : '') || 'Movimiento CaixaBank';
    const type = classifyCaixaBankConcept(concept, amount);
    const balance = balanceCol >= 0 ? parseNumber(row[balanceCol]) : undefined;

    movements.push({
      id: movementId('caixabank', date, type, concept, amount, balanceCol >= 0 ? row[balanceCol] ?? '' : ''),
      fileId: '',
      bank: 'caixabank',
      date,
      type,
      concept,
      amount,
      balance: balance ?? undefined,
    });
  }

  return { movements, skipped };
}

function classifyCaixaBankConcept(concept: string, amount: number): MovementType {
  const t = norm(concept);
  // Intereses de plazo fijo: se tratan como «venta» (devolución del plazo).
  if (/INTERES.*PLAZO|PLAZO.*INTERES/.test(t)) return 'sell';
  if (/INTERES/.test(t)) return 'interest';
  if (/COMISION/.test(t)) return 'fee';
  if (/TRASPASO|TRANSFERENCIA|BIZUM ENV/.test(t)) return 'transfer';
  // Depósito a plazo: constitución (compra) o cancelación / devolución (venta).
  // El patrón CONST solo coincide con CONST seguido de . y AHORRO, no con
  // CONSTRUIR u otras palabras que empiecen por CONST.
  if (/CONST\.?\s*AHORRO|CANC\w*\.?\s*.*AHORRO|DEPOSITO|APORTE.*PLAZO|PLAZO.*APORTE/.test(t)) {
    return amount < 0 ? 'buy' : 'sell';
  }
  if (/DEV\.IMPUESTOS|IMPUESTO|DEVOLUCION IMPUESTOS/.test(t)) return 'tax';
  if (/IRPF MOD|I\.V\.A\.? MOD|TGSS/.test(t)) return 'tax';
  if (/DEVOLUCION|BIZUM RECIBIDO|REEMBOLSO|REFUND/.test(t)) return 'refund';
  if (/NOMINA|PENSION|SUELDO|INGRESO/.test(t)) return 'income';
  if (
    /RECIBO|TARJETA|COMERCIO|DOMICILI|SEPA|TELEFON|SEGUR|LUZ|GAS\b|AGUA|HIPOTECA|PRESTAMO|TRIBUTOS|SUSCRIP|BIZUM|PAGO A PLAZOS|COMPRA CON/.test(t)
  ) {
    return 'expense';
  }
  return amount <= 0 ? 'expense' : 'income';
}

// ---------------------------------------------------------------------------
// Santander
// ---------------------------------------------------------------------------

function classifySantanderConcept(concept: string, amount: number): MovementType {
  const t = norm(concept);
  if (/INTERES/.test(t)) return 'interest';
  if (/COMISION/.test(t)) return 'fee';
  if (/DEV\.IMPUESTOS|IMPUESTO|RETENCION/.test(t)) return 'tax';
  if (/IRPF MOD|I\.V\.A\.? MOD|TGSS/.test(t)) return 'tax';
  if (/DEVOLUCION|DEVOLUCIÓN|BIZUM RECIBIDO|REEMBOLSO|REFUND/.test(t)) return 'refund';
  // La nómina llega como transferencia abonada (p. ej. «TRANSFERENCIA DE …
  // CONCEPTO ABONO NOMINA 08 2026»): el concepto de ingreso prevalece.
  if (/NOMINA|PENSION|SUELDO|INGRESO/.test(t)) return 'income';
  if (/TRASPASO|TRANSFERENCIA|BIZUM ENV/.test(t)) return 'transfer';
  if (
    /RECIBO|TARJETA|COMERCIO|DOMICILI|SEPA|TELEFON|SEGUR|LUZ|GAS\b|AGUA|HIPOTECA|PRESTAMO|TRIBUTOS|SUSCRIP|BIZUM|PAGO A PLAZOS|COMPRA CON/.test(t)
  ) {
    return 'expense';
  }
  return amount <= 0 ? 'expense' : 'income';
}

export function parseSantander(matrix: CellMatrix): ParsedBankFile {
  // El extracto de Santander trae bloques previos (cuenta, titular, saldo) y
  // una cabecera de sección «Movimientos» antes de la fila con las columnas
  // reales. Se busca la fila que más coincide con los nombres de columna
  // esperados en lugar de la primera que contenga una palabra suelta.
  const headerKeywords = ['FECHA OPERACION', 'FECHA VALOR', 'CONCEPTO', 'IMPORTE', 'SALDO', 'DIVISA'];
  let headerIdx = -1;
  let bestScore = 0;
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r].map(norm);
    let score = 0;
    for (const kw of headerKeywords) {
      if (row.some(c => c.includes(kw))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      headerIdx = r;
    }
  }
  if (headerIdx < 0 || bestScore < 2) return { movements: [], skipped: matrix.length };
  const header = matrix[headerIdx].map(c => norm(c));

  const opDateCol = findColumn(header, c => c.includes('FECHA OPERACION'));
  const valDateCol = findColumn(header, c => c.includes('FECHA VALOR'));
  const dateCol = opDateCol >= 0 ? opDateCol : valDateCol >= 0 ? valDateCol : findColumn(header, c => c.startsWith('FECHA'));
  const conceptCol = findColumn(header, c => c.includes('CONCEPTO'));
  const amountCol = findColumn(header, c => c.includes('IMPORTE'));
  const balanceCol = findColumn(header, c => c.includes('SALDO'));

  if (dateCol < 0 || amountCol < 0) return { movements: [], skipped: matrix.length };

  const movements: Movement[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row.some(c => c.length > 0)) continue;

    const date = dateCol >= 0 ? parseDateToISO(row[dateCol]) : undefined;
    const amount = amountCol >= 0 ? parseNumber(row[amountCol]) : undefined;
    if (!date || amount === undefined) {
      skipped++;
      continue;
    }

    const concept = (conceptCol >= 0 ? row[conceptCol] : '') || 'Movimiento Santander';
    const type = classifySantanderConcept(concept, amount);
    const balanceRaw = balanceCol >= 0 ? (row[balanceCol] ?? '') : '';
    const balance = parseNumber(balanceRaw);

    movements.push({
      id: movementId('santander', date, type, concept, amount, balanceRaw),
      fileId: '',
      bank: 'santander',
      date,
      type,
      concept,
      amount,
      balance: balance ?? undefined,
    });
  }

  return { movements, skipped };
}

// ---------------------------------------------------------------------------
// PayPal
// ---------------------------------------------------------------------------

function classifyPayPalConcept(text: string, amount: number): MovementType {
  const t = norm(text);
  // Conversiones de divisas son reasignaciones internas de PayPal emparejadas
  // con un pago/reembolso; no representan un flujo de caja real por separado y
  // se filtran al importar.
  if (/CONVERSION DE DIVISAS|CONVERSION MONEDA|CURRENCY CONVERSION/.test(t)) return 'other';
  // Retenciones provisionales de autorizaciones abiertas y sus cancelaciones
  // son bloqueos/liberaciones de saldo sin movimiento de caja real (se filtran).
  if (/RETENCION DE CUENTA PARA AUTORIZACION ABIERTA/.test(t)) return 'other';
  if (/CANCELACION DE RETENCION DE CUENTA GENERAL/.test(t)) return 'other';
  // Las «Autorización general» de PayPal son autorizaciones/holds del propio
  // PayPal, no un movimiento de caja real; se filtran al importar (p. ej. las
  // destinadas a compras que luego se confirman por separado). Igual ocurre con
  // los movimientos «Desprovisto de autorización».
  if (/AUTORIZACION GENERAL/.test(t)) return 'other';
  if (/DESPROVISTO DE AUTORIZACION/.test(t)) return 'other';
  // Depósitos bancarios en PayPal (dinero que entra, asociado a un gasto) y
  // retiradas iniciadas por el usuario (dinero que sale, asociado a una
  // devolución) son traspasos de fondos entre el banco y PayPal, no un ingreso
  // ni una retirada real.
  if (/DEPOSITO BANCARIO EN CUENTA PAYPAL/.test(t)) return 'transfer';
  if (/RETIRADA INICIADA POR EL USUARIO/.test(t)) return 'transfer';
  if (/REEMBOLSO|REIMBOLSO|REEMBURSEMENT|REFUND/.test(t)) return 'refund';
  if (/RECIBIDO.*FAMILIA|RECIBIDO.*AMIGO|AMIGOS.?Y FAMILIA/.test(t)) return 'refund';
  if (/\bPAGO/.test(t) || /PAYMENT|COMPRA|PURCHASE/.test(t)) return 'expense';
  if (/TRANSFERENCIA|TRANSFER|DONACION|DONATION/.test(t) && amount < 0) return 'expense';
  if (/RETIRADA|WITHDRAWAL|RETIRO/.test(t)) return 'withdrawal';
  if (/COMISION|TAXA|FEE/.test(t)) return 'fee';
  return amount <= 0 ? 'expense' : 'income';
}

/**
 * Detecta el delimitador columnar del CSV de PayPal. PayPal exporta separado
 * por tabuladores; aunque también puede venir como ; o ,. Reutiliza la
 * detección general pero desactivando la preferencia por «;», ya que PayPal
 * puede usar «;» dentro de los correos o nombres del fichero.
 */
export function parsePayPal(matrix: CellMatrix): ParsedBankFile {
  const headerIdx = matrix.findIndex(row => {
    const joined = row.map(norm).join(' ');
    const hasDate = joined.includes('FECHA');
    const hasAmount = joined.includes('BRUTO') || joined.includes('NETO') || joined.includes('IMPORTE');
    return hasDate && hasAmount;
  });
  if (headerIdx < 0) return { movements: [], skipped: matrix.length };
  const header = matrix[headerIdx].map(c => norm(c));

  const col = {
    date: findColumn(header, c => c === 'FECHA'),
    time: findColumn(header, c => c === 'HORA'),
    timezone: findColumn(header, c => c.includes('ZONA HORARIA')),
    description: findColumn(header, c => c === 'DESCRIPCION'),
    tipo: findColumn(header, c => c === 'TIPO'),
    name: findColumn(header, c => c === 'NOMBRE'),
    currency: findColumn(header, c => c === 'DIVISA'),
    gross: findColumn(header, c => c === 'BRUTO'),
    importe: findColumn(header, c => c === 'IMPORTE'),
    net: findColumn(header, c => c === 'NETO'),
    fee: findColumn(header, c => c === 'COMISION' || c === 'TARIFAS'),
    balance: findColumn(header, c => c === 'SALDO'),
    transactionId: findColumn(header, c => c.replace(/\./g, '').includes('ID DE TRANSACCION')),
  };
  // Columna de importe: en el formato nuevo PayPal la llama «Importe», en los
  // antiguos «Bruto» o «Neto».
  const amountCol = col.importe >= 0 ? col.importe : (col.gross >= 0 ? col.gross : col.net);
  if (col.date < 0 || amountCol < 0) {
    return { movements: [], skipped: matrix.length };
  }

  const movements: Movement[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row.some(c => c.length > 0)) continue;

    const date = col.date >= 0 ? parseDateToISO(row[col.date]) : undefined;
    const amount = parseNumber(row[amountCol]);
    if (!date || amount === undefined) {
      skipped++;
      continue;
    }

    const time = col.time >= 0 ? String(row[col.time] ?? '').trim() : '';
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})/);
    const datetime = timeMatch
      ? `${date}T${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
      : undefined;

    // En los ficheros nuevos el tipo va en la columna «Tipo»; en los antiguos es
    // la descripción. Se combinan ambas (la descripción puede añadir detalle).
    const rawTipo = col.tipo >= 0 ? row[col.tipo] : '';
    const rawDescription = (col.description >= 0 ? row[col.description] : '') || '';
    const typeText = norm(`${rawTipo} ${rawDescription}`).trim() || 'MOVIMIENTO PAYPAL';
    const type = classifyPayPalConcept(typeText, amount);
    // Las conversiones de divisas y autorizaciones generales se filtran: son
    // pares/bloqueos internos de PayPal sin movimiento de caja real.
    if (type === 'other') {
      skipped++;
      continue;
    }
    // El concepto es el nombre del comercio/contraparte (columna «Nombre»),
    // que es lo que comparten el banco y PayPal; el tipo/descripción solo sirve
    // de respaldo cuando no hay nombre.
    const name = (col.name >= 0 ? row[col.name] : '') || '';
    const concept = name || rawTipo || rawDescription || 'Movimiento PayPal';
    const currency = col.currency >= 0 ? row[col.currency] : '';
    const balanceRaw = col.balance >= 0 ? (row[col.balance] ?? '') : '';
    const balance = parseNumber(balanceRaw);
    const transactionId = col.transactionId >= 0 ? (row[col.transactionId] ?? '') : '';

    movements.push({
      id: movementId('paypal', date, type, concept, amount, `${currency}|${transactionId}`),
      fileId: '',
      bank: 'paypal',
      date,
      datetime,
      type,
      concept,
      amount,
      balance: balance ?? undefined,
      referenceId: transactionId || undefined,
    });
  }

  return { movements, skipped };
}

// ---------------------------------------------------------------------------
// Revolut
// ---------------------------------------------------------------------------

function classifyRevolutType(rawTipo: string, concept: string, amount: number): MovementType {
  const t = norm(rawTipo);
  const c = norm(concept);

  if (/RECARGAS/.test(t)) return 'transfer';
  if (/TRASPASO/.test(c) || /CUENTA REMUNERADA/.test(c)) return 'transfer';
  if (/INTERES/.test(c)) return 'interest';
  if (/COMISION/.test(c)) return 'fee';
  if (/DEVOLUCION|REFUND|REEMBOLSO/.test(c)) return 'refund';
  if (/NOMINA|SUELDO|SALARY|INGRESO/.test(c)) return 'income';
  if (/TARJETA|CARD|PAGO|COMPRA|PAYMENT|PURCHASE/.test(c)) return 'expense';
  if (/RETIRADA|WITHDRAWAL/.test(c)) return 'withdrawal';
  return amount <= 0 ? 'expense' : 'income';
}

export function parseRevolut(matrix: CellMatrix): ParsedBankFile {
  const headerIdx = firstHeaderIndex(
    matrix,
    c => c.includes('TIPO') || c.includes('TYPE') || c.includes('DESCRIPCION') || c.includes('SALDO')
  );
  if (headerIdx < 0) return { movements: [], skipped: matrix.length };
  const header = matrix[headerIdx].map(c => norm(c));

  const col = {
    tipo: findColumn(header, c => c === 'TIPO' || c === 'TYPE'),
    producto: findColumn(header, c => c === 'PRODUCTO' || c === 'PRODUCT'),
    dateStart: findColumn(header, c => c.includes('FECHA DE INICIO') || c.includes('START DATE')),
    description: findColumn(header, c => c === 'DESCRIPCION' || c === 'DESCRIPTION'),
    amount: findColumn(header, c => c === 'IMPORTE' || c === 'AMOUNT'),
    fee: findColumn(header, c => c === 'COMISION' || c === 'FEE'),
    currency: findColumn(header, c => c === 'DIVISA' || c === 'CURRENCY'),
    balance: findColumn(header, c => c === 'SALDO' || c === 'BALANCE'),
  };

  if (col.dateStart < 0 || col.amount < 0) {
    return { movements: [], skipped: matrix.length };
  }

  const movements: Movement[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row.some(c => c.length > 0)) continue;

    const date = parseDateToISO(row[col.dateStart]);
    const rawAmount = parseNumber(row[col.amount]);
    if (!date || rawAmount === undefined) {
      skipped++;
      continue;
    }

    const rawTipo = col.tipo >= 0 ? String(row[col.tipo] ?? '').trim() : '';
    const rawDescription = col.description >= 0 ? String(row[col.description] ?? '').trim() : '';
    const concept = rawDescription || 'Movimiento Revolut';

    const fee = col.fee >= 0 ? parseNumber(row[col.fee]) : undefined;

    let amount = rawAmount;
    if (fee !== undefined && fee !== 0) {
      amount = amount - Math.abs(fee);
    }

    const type = classifyRevolutType(rawTipo, concept, amount);

    const currency = col.currency >= 0 ? String(row[col.currency] ?? '').trim() : '';

    const balanceRaw = col.balance >= 0 ? (row[col.balance] ?? '') : '';
    const balance = parseNumber(balanceRaw);

    movements.push({
      id: movementId('revolut', date, type, concept, amount, `${rawTipo}|${currency}|${fee ?? ''}`),
      fileId: '',
      bank: 'revolut',
      date,
      type,
      concept,
      amount,
      balance: balance ?? undefined,
    });
  }

  return { movements, skipped };
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

export function detectMyInvestorFormat(matrix: CellMatrix): 'funds' | 'account' {
  // Detección por cabecera:ISIN como texto (incluye "OperacionISIN" tras limpieza HTML)
  const headerMatch = matrix.some(row => row.some(c => {
    const n = norm(c);
    return n === 'ISIN' || n.includes(' ISIN') || n.endsWith('ISIN');
  }));
  if (headerMatch) return 'funds';
  // Detección por datos: alguna celda contiene un código ISIN real
  return matrix.some(row => row.some(c => ISIN_REGEX.test(c.trim().toUpperCase())))
    ? 'funds'
    : 'account';
}

export function parseBankMatrix(bank: BankId, _fileName: string, matrix: CellMatrix): ParsedBankFile {
  let parsed: ParsedBankFile;
  switch (bank) {
    case 'trade-republic':
      parsed = parseTradeRepublic(matrix);
      break;
    case 'myinvestor':
      parsed = detectMyInvestorFormat(matrix) === 'funds'
        ? parseMyInvestorFunds(matrix)
        : parseMyInvestorAccount(matrix);
      break;
    case 'caixabank':
      parsed = parseCaixaBank(matrix);
      break;
    case 'santander':
      parsed = parseSantander(matrix);
      break;
    case 'paypal':
      parsed = parsePayPal(matrix);
      break;
    case 'revolut':
      parsed = parseRevolut(matrix);
      break;
  }
  // Corrige el signo de gastos/devoluciones (p. ej. reembolsos positivos de
  // tarjeta que el clasificador haya tipado como gasto), igual que hace la
  // normalización del histórico, para que las firmas coincidan al reimportar.
  return { ...parsed, movements: reclassifySignMismatched(parsed.movements) };
}
