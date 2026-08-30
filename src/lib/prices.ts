/**
 * Precios actuales desde Yahoo Finance para ETFs, acciones y fondos.
 *
 * La app es un sitio estático: todo se consulta desde el navegador, donde las
 * peticiones directas a query1.finance.yahoo.com las bloquea CORS. Por eso se
 * encadenan proxies públicos y se usa el endpoint v8/chart, que no exige
 * cookies ni crumbs.
 *
 * Estrategia por activo:
 *  - Con ticker: se prueba el símbolo tal cual y con sufijos de bolsa (.DE, .MC).
 *  - Fondos (sin cotización continua): se resuelve su ISIN al símbolo interno
 *    de Yahoo mediante el endpoint público de búsqueda (p. ej. IE00B03HD191 →
 *    0P0000XW61.F) y luego se consulta su NAV como cualquier símbolo.
 *
 * Caché local (localStorage) para no repetir peticiones: precios con una TTL
 * corta y resoluciones ISIN→símbolo permanentes.
 */

export interface PriceFetchOutcome {
  fetched: Record<string, number>;
  failed: string[];
}

export interface PriceRequest {
  /** Clave bajo la que se guarda el precio (coincide con Holding.key). */
  key: string;
  ticker?: string;
  isin?: string;
}

const TIMEOUT_MS = 8000;
const PRICE_TTL_MS = 10 * 60 * 1000;
const CHUNK_SIZE = 3;
const CHUNK_DELAY_MS = 400;

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_SEARCH_BASE = 'https://query1.finance.yahoo.com/v1/finance/search?q=';
const CHART_QUERY = '?interval=1d&range=5d';

// La URL directa va al final: en el navegador la bloquea CORS, pero permite
// usar el módulo sin proxies en Node (tests, scripts locales).
const PROXIES: ReadonlyArray<(url: string) => string> = [
  url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => url,
];

const SYMBOLS_CACHE_KEY = 'nestegg-yahoo-symbols-v1';
const PRICES_CACHE_KEY = 'nestegg-yahoo-prices-v1';

type SymbolCache = Record<string, string>; // ISIN → símbolo interno de Yahoo ('' = sin resultado)
type PriceCache = Record<string, { price: number; ts: number }>;

let memorySymbols: SymbolCache | null = null;
let memoryPrices: PriceCache | null = null;

function readStorage<T>(key: string): T | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // almacenamiento lleno o no disponible: seguimos sin caché persistente
  }
}

function symbolCache(): SymbolCache {
  memorySymbols ??= readStorage<SymbolCache>(SYMBOLS_CACHE_KEY) ?? {};
  return memorySymbols;
}

function priceCache(): PriceCache {
  memoryPrices ??= readStorage<PriceCache>(PRICES_CACHE_KEY) ?? {};
  return memoryPrices;
}

/** Borra cachés en memoria (y del almacenamiento si existe). Solo para tests. */
export function resetPriceCaches(): void {
  memorySymbols = {};
  memoryPrices = {};
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SYMBOLS_CACHE_KEY);
      localStorage.removeItem(PRICES_CACHE_KEY);
    }
  } catch {
    // ignorar
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function timedFetch(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Descarga y parsea JSON probando cada proxy en orden. Un 200 con contenido
 * inservible (p. ej. la página de error del propio proxy) no se acepta como
 * resultado: se sigue con el siguiente proxy para la misma URL.
 */
async function fetchJsonViaProxies<T>(
  url: string,
  extract: (json: unknown) => T | undefined
): Promise<T | undefined> {
  for (const proxy of PROXIES) {
    const res = await timedFetch(proxy(url));
    if (!res || !res.ok) continue;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      continue; // respuesta no JSON o truncada: siguiente proxy
    }
    const value = extract(json);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Símbolos Yahoo a probar para un ticker: tal cual y bolsas europeas habituales. */
export function candidateSymbolsForTicker(ticker: string): string[] {
  const t = ticker.trim().toUpperCase();
  if (!t) return [];
  if (t.includes('.')) return [t];
  return [t, `${t}.DE`, `${t}.MC`];
}

interface ChartMeta {
  regularMarketPrice?: unknown;
  previousClose?: unknown;
}

/** Extrae el precio de la respuesta del endpoint v8/chart. */
export function extractChartPrice(json: unknown): number | undefined {
  const meta = (json as { chart?: { result?: Array<{ meta?: ChartMeta }> } })?.chart?.result?.[0]
    ?.meta;
  const price = meta?.regularMarketPrice ?? meta?.previousClose;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : undefined;
}

/** Extrae el símbolo interno del primer resultado de búsqueda (por ISIN o nombre). */
export function extractSearchSymbol(json: unknown): string | undefined {
  const quotes = (json as { quotes?: Array<{ symbol?: unknown }> })?.quotes;
  const symbol = quotes?.[0]?.symbol;
  return typeof symbol === 'string' && symbol.length > 0 ? symbol : undefined;
}

/**
 * Resuelve el símbolo interno de Yahoo para un ISIN (fondos y algunos ETFs).
 * El resultado correcto se cachea de forma permanente: el símbolo de un ISIN
 * no cambia. Los fallos NO se cachean: un proxy caído no debe condenar el
 * ISIN para siempre en sucesivas actualizaciones.
 */
export async function resolveIsinSymbol(isin: string): Promise<string | undefined> {
  const normalized = isin.trim().toUpperCase();
  if (!normalized) return undefined;

  const cached = symbolCache()[normalized];
  if (cached) return cached;

  const symbol = await fetchJsonViaProxies(
    `${YAHOO_SEARCH_BASE}${encodeURIComponent(normalized)}&quotesCount=1&newsCount=0`,
    extractSearchSymbol
  );
  if (symbol) {
    const cache = symbolCache();
    cache[normalized] = symbol;
    writeStorage(SYMBOLS_CACHE_KEY, cache);
  }
  return symbol;
}

async function fetchChartPrice(symbol: string): Promise<number | undefined> {
  return fetchJsonViaProxies(
    `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}${CHART_QUERY}`,
    extractChartPrice
  );
}

async function fetchPriceForRequest(
  req: PriceRequest,
  options: { force: boolean }
): Promise<number | undefined> {
  const cachedEntry = priceCache()[req.key];
  if (!options.force && cachedEntry && Date.now() - cachedEntry.ts < PRICE_TTL_MS) {
    return cachedEntry.price;
  }

  const candidates: string[] = [];
  if (req.ticker) candidates.push(...candidateSymbolsForTicker(req.ticker));
  if (req.isin) {
    const resolved = await resolveIsinSymbol(req.isin);
    if (resolved && !candidates.includes(resolved)) candidates.push(resolved);
  }

  for (const symbol of candidates) {
    const price = await fetchChartPrice(symbol);
    if (price !== undefined) {
      const cache = priceCache();
      cache[req.key] = { price, ts: Date.now() };
      writeStorage(PRICES_CACHE_KEY, cache);
      return price;
    }
  }
  return undefined;
}

/**
 * Consulta el precio actual de cada activo. Los resultados se devuelven
 * indexados por `req.key`; los fallos también, junto a su etiqueta opcional.
 */
export async function fetchPrices(
  requests: PriceRequest[],
  options: { force?: boolean } = {}
): Promise<PriceFetchOutcome> {
  const unique = new Map<string, PriceRequest>();
  for (const r of requests) {
    if (r.key && !unique.has(r.key)) unique.set(r.key, r);
  }

  const fetched: Record<string, number> = {};
  const failed: string[] = [];
  const list = [...unique.values()];

  for (let i = 0; i < list.length; i += CHUNK_SIZE) {
    const chunk = list.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async req => {
        const price = await fetchPriceForRequest(req, { force: options.force ?? false });
        if (price !== undefined) fetched[req.key] = price;
        else failed.push(req.key);
      })
    );
    if (i + CHUNK_SIZE < list.length) await sleep(CHUNK_DELAY_MS);
  }

  return { fetched, failed };
}
