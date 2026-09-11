import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  candidateSymbolsForTicker,
  extractChartPrice,
  extractSearchSymbol,
  fetchPrices,
  resetPriceCaches,
} from '../prices';

type FetchMock = (url: string) => { ok: boolean; status: number; json: () => Promise<unknown> };

function stubFetch(mock: FetchMock) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string | URL) => {
    // Los proxies envuelven la URL destino codificada; decodificamos para que
    // los mocks distingan endpoints igual con y sin wrapper.
    const decoded = decodeURIComponent(String(url));
    calls.push(decoded);
    return mock(decoded);
  });
  return calls;
}

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function fail() {
  return { ok: false, status: 403, json: async () => ({}) };
}

const SEARCH_JSON = { quotes: [{ symbol: '0P0000XW61.F', longname: 'Fondo prueba' }] };

describe('candidateSymbolsForTicker', () => {
  it('añade sufijos de bolsa europeos a tickers desnudos', () => {
    expect(candidateSymbolsForTicker('vwce')).toEqual(['VWCE', 'VWCE.DE', 'VWCE.MC']);
  });
  it('respeta los símbolos que ya llevan bolsa', () => {
    expect(candidateSymbolsForTicker('TEF.MC')).toEqual(['TEF.MC']);
  });
  it('devuelve vacío sin ticker', () => {
    expect(candidateSymbolsForTicker('   ')).toEqual([]);
  });
});

describe('extractChartPrice / extractSearchSymbol', () => {
  it('lee regularMarketPrice y usa previousClose como alternativa', () => {
    expect(extractChartPrice({ chart: { result: [{ meta: { regularMarketPrice: 42.5 } }] } })).toBe(42.5);
    expect(extractChartPrice({ chart: { result: [{ meta: { previousClose: 41 } }] } })).toBe(41);
  });
  it('rechaza precios no numéricos o no positivos', () => {
    expect(extractChartPrice({ chart: { result: [{ meta: { regularMarketPrice: 0 } }] } })).toBeUndefined();
    expect(extractChartPrice({ chart: { result: [{ meta: {} }] } })).toBeUndefined();
    expect(extractChartPrice(null)).toBeUndefined();
  });
  it('extrae el símbolo interno del primer resultado de búsqueda', () => {
    expect(extractSearchSymbol(SEARCH_JSON)).toBe('0P0000XW61.F');
    expect(extractSearchSymbol({ quotes: [] })).toBeUndefined();
    expect(extractSearchSymbol({})).toBeUndefined();
  });
});

describe('fetchPrices (con red simulada)', () => {
  beforeEach(() => {
    resetPriceCaches();
    vi.unstubAllGlobals();
  });

  it('prueba sufijos hasta encontrar el precio del ticker', async () => {
    const calls = stubFetch(url =>
      url.includes('chart/VWCE.DE') ? okJson({ chart: { result: [{ meta: { regularMarketPrice: 130.2 } }] } }) : fail()
    );

    const outcome = await fetchPrices([{ key: 'VWCE-key', ticker: 'VWCE' }]);
    expect(outcome.fetched['VWCE-key']).toBe(130.2);
    expect(outcome.failed).toEqual([]);
    // El primer intento es el símbolo desnudo (falla); el segundo, .DE
    expect(calls.some(c => c.includes('chart/VWCE?'))).toBe(true);
    expect(calls.filter(c => c.includes('chart/VWCE.DE')).length).toBeGreaterThan(0);
  });

  it('resuelve fondos por ISIN mediante la búsqueda de Yahoo', async () => {
    const calls = stubFetch(url => {
      if (url.includes('/v1/finance/search?q=')) return okJson(SEARCH_JSON);
      if (url.includes('chart/0P0000XW61.F'))
        return okJson({ chart: { result: [{ meta: { regularMarketPrice: 105.75 } }] } });
      return fail();
    });

    const outcome = await fetchPrices([{ key: 'fondo-key', isin: 'IE00B03HD191' }]);
    expect(outcome.fetched['fondo-key']).toBe(105.75);
    expect(calls.filter(c => c.includes('/v1/finance/search?q=IE00B03HD191')).length).toBeGreaterThan(0);
    expect(calls.filter(c => c.includes('chart/0P0000XW61.F')).length).toBeGreaterThan(0);
  });

  it('sirve desde caché dentro de la TTL sin repetir peticiones', async () => {
    let calls: string[] = [];
    calls = stubFetch(url => {
      if (url.includes('/v1/finance/search?q=')) return okJson({ quotes: [{ symbol: 'SYM.F' }] });
      return okJson({ chart: { result: [{ meta: { regularMarketPrice: 7.77 } }] } });
    });
    await fetchPrices([{ key: 'k', isin: 'IE00TEST0001' }]);
    const afterFirst = calls.length;

    calls = stubFetch(() => okJson({ chart: { result: [{ meta: { regularMarketPrice: 9.99 } }] } }));
    const second = await fetchPrices([{ key: 'k', isin: 'IE00TEST0001' }]);
    expect(second.fetched.k).toBe(7.77); // precio en caché, no el nuevo
    expect(calls.length).toBe(0);
    expect(afterFirst).toBeGreaterThan(0);

    // Con force se ignora la caché y se actualiza
    const forced = await fetchPrices([{ key: 'k', isin: 'IE00TEST0001' }], { force: true });
    expect(forced.fetched.k).toBe(9.99);
  });

  it('reporta como fallidos los activos sin precio en ninguna fuente', async () => {
    stubFetch(() => fail());
    const outcome = await fetchPrices([
      { key: 'a', ticker: 'NOPE' },
      { key: 'b', isin: 'IE00NOPE0001' },
    ]);
    expect(Object.keys(outcome.fetched)).toEqual([]);
    expect(new Set(outcome.failed)).toEqual(new Set(['a', 'b']));
  });

  it('descarta respuestas 200 con contenido inservible y prueba el siguiente proxy', async () => {
    const calls = stubFetch(url => {
      if (url.startsWith('https://corsproxy.io/')) return okJson({ error: 'rate limited' });
      return okJson({ chart: { result: [{ meta: { regularMarketPrice: 55.5 } }] } });
    });

    const outcome = await fetchPrices([{ key: 'x', ticker: 'ACME' }]);
    expect(outcome.fetched.x).toBe(55.5);
    // El primer proxy respondió 200 pero inútil; se recurrió al siguiente
    expect(calls.some(c => c.startsWith('https://corsproxy.io/'))).toBe(true);
    expect(calls.some(c => c.startsWith('https://api.codetabs.com/'))).toBe(true);
  });

  it('no cachea resoluciones de ISIN fallidas: reintenta en la siguiente actualización', async () => {
    let searchFails = true;
    stubFetch(url => {
      if (url.includes('/v1/finance/search?q='))
        return searchFails ? fail() : okJson({ quotes: [{ symbol: 'RECOVERED.F' }] });
      return okJson({ chart: { result: [{ meta: { regularMarketPrice: 3.21 } }] } });
    });

    const first = await fetchPrices([{ key: 'a', isin: 'IE00FAIL0001' }]);
    expect(first.failed).toEqual(['a']);

    searchFails = false;
    const second = await fetchPrices([{ key: 'a', isin: 'IE00FAIL0001' }]);
    expect(second.fetched.a).toBe(3.21);
  });
});
