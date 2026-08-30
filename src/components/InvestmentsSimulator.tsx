import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '../lib/calculations';
import {
  BANKS,
  MOVEMENT_TYPE_LABELS,
  hashId,
  mergeSplitTrades,
  movementSignature,
  normalizeStoredMovements,
  parseBankMatrix,
  readFileAsMatrix,
  type BankId,
  type FileMeta,
  type Movement,
  type MovementType,
} from '../lib/bankImports';
import {
  EXPENSE_CATEGORY_LIST,
  buildConceptCategoryMap,
  cleanConcept,
  computeAccountEvolution,
  computeBankBreakdown,
  computeCashBalance,
  computeExpenses,
  computeIncome,
  computeInterest,
  computePortfolio,
  guessExpenseCategory,
  interestNetAmount,
  resolveExpenseCategory,
  type AccountEvolutionPoint,
  type BankBreakdownEntry,
  type CategoryTotal,
  type Holding,
  type PlazoFijoConfig,
} from '../lib/investments';
import { fetchPrices, type PriceRequest } from '../lib/prices';
import { useLocalStorage } from '../lib/sharedStore';
import {
  ChartTooltip,
  FormContainer,
  FormSection,
  Modal,
  NoteCard,
  ResultsContainer,
  ScenarioSection,
  ScrollableTable,
  SimulatorLayout,
  SummaryCard,
  Tooltip,
} from './common';

interface InvestmentsStore {
  files: FileMeta[];
  movements: Movement[];
}

interface PriceEntry {
  value: number;
  source: 'auto' | 'manual';
}

type PriceMap = Record<string, PriceEntry>;

interface ImportFeedback {
  kind: 'success' | 'warning' | 'error';
  text: string;
}

type SectionTab = 'portfolio' | 'account' | 'income' | 'expenses' | 'movements';

const SECTION_TABS: ReadonlyArray<{ id: SectionTab; label: string }> = [
  { id: 'portfolio', label: 'Cartera' },
  { id: 'account', label: 'Cuenta' },
  { id: 'income', label: 'Ingresos' },
  { id: 'expenses', label: 'Gastos' },
  { id: 'movements', label: 'Movimientos' },
];

const TYPE_COLORS: Record<MovementType, string> = {
  buy: 'text-emerald-700',
  deposit: 'text-emerald-700',
  income: 'text-emerald-700',
  perk: 'text-fuchsia-700',
  sell: 'text-blue-700',
  dividend: 'text-violet-700',
  interest: 'text-amber-700',
  expense: 'text-red-700',
  withdrawal: 'text-red-700',
  transfer: 'text-gray-500',
  fee: 'text-gray-500',
  tax: 'text-gray-500',
  refund: 'text-teal-700',
  other: 'text-gray-500',
};

const BANK_LABELS: Record<BankId, string> = Object.fromEntries(
  BANKS.map(b => [b.id, b.label])
) as Record<BankId, string>;

function fmtMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
}

function signedAmount(value: number): string {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`;
}

/** Reparto del capital entre cartera y efectivo, con porcentaje sobre el total. */
function capitalSplitSubtitle(cartera: number, cuenta: number): string {
  const total = cartera + cuenta;
  const pct = (v: number) => (total > 0.005 ? ` (${Math.round((v / total) * 100)}%)` : '');
  return `Cartera ${formatCurrency(cartera)}${pct(cartera)} · Cuenta ${formatCurrency(cuenta)}${pct(cuenta)}`;
}

function pnlColor(value: number): string {
  if (value > 0.005) return 'text-emerald-600 font-semibold';
  if (value < -0.005) return 'text-red-600 font-semibold';
  return 'text-gray-500';
}

export default function InvestmentsSimulator() {
  const [store, setStore] = useLocalStorage<InvestmentsStore>('nestegg-investments-v1', {
    files: [],
    movements: [],
  });
  const [priceMap, setPriceMap] = useLocalStorage<PriceMap>('nestegg-prices-v1', {});
  // Parámetros declarados por el usuario para cada depósito a plazo (TIR + duración).
  const [plazoConfigs, setPlazoConfigs] = useLocalStorage<Record<string, PlazoFijoConfig>>('nestegg-plazos-v1', {});
  const [bank, setBank] = useState<BankId>('trade-republic');
  const [tab, setTab] = useState<SectionTab>('portfolio');
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [priceStatus, setPriceStatus] = useState<string | null>(null);
  const [movementFilter, setMovementFilter] = useState<'all' | MovementType>('all');
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingCategoryChange, setPendingCategoryChange] = useState<{
    movementId: string;
    category: string;
    ids: string[];
    concept: string;
  } | null>(null);
  const [pendingTypeChange, setPendingTypeChange] = useState<{
    movementId: string;
    type: MovementType;
    ids: string[];
    concept: string;
  } | null>(null);

  const priceOf = (key: string, ticker?: string, isin?: string): number | undefined => {
    if (!key) return undefined;
    if (priceMap[key]) return priceMap[key].value;
    if (ticker && priceMap[ticker]) return priceMap[ticker].value;
    if (isin && priceMap[isin]) return priceMap[isin].value;
    return undefined;
  };

  const portfolio = useMemo(
    () => computePortfolio(store.movements, priceOf, plazoConfigs),
    [store.movements, priceMap, plazoConfigs]
  );
  const interest = useMemo(() => {
    const interestMovements = store.movements.filter(m => m.type === 'interest');
    const taxOnInterest = store.movements.filter(
      m => m.type === 'tax' && /INTERES/i.test(m.concept)
    );
    return computeInterest(interestMovements, taxOnInterest);
  }, [store.movements]);
  const expenses = useMemo(
    () => computeExpenses(store.movements.filter(m => m.type === 'expense' || m.type === 'refund')),
    [store.movements]
  );
  const income = useMemo(
    () => computeIncome(store.movements.filter(m => m.type === 'income')),
    [store.movements]
  );

  const hasData = store.movements.length > 0;

  // Normaliza los datos guardados al arrancar: reclasifica perks antiguos
  // (STOCKPERK guardados como ingreso), fusiona órdenes partidas por el banco
  // y elimina duplicados heredados de versiones anteriores. Además recalcula
  // la categoría de los movimientos no editados manualmente (categoryAuto !==
  // false) para aplicar las reglas nuevas sin pisar ediciones del usuario.
  useEffect(() => {
    setStore(prev => {
      const normalized = normalizeStoredMovements(prev.movements)
      const map = buildConceptCategoryMap(normalized);
      return {
        ...prev,
        movements: normalized.map(m => {
          if (m.categoryAuto === false) return m;
          return {
            ...m,
            category: resolveExpenseCategory(m.concept, normalized),
            categoryAuto: true,
          };
        }),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cashBalance = useMemo(
    () => computeCashBalance(store.movements),
    [store.movements]
  );
  const account = useMemo(
    () => computeAccountEvolution(store.movements),
    [store.movements]
  );
  const bankBreakdown = useMemo(
    () => computeBankBreakdown(store.movements),
    [store.movements]
  );

  const totalCapital = portfolio.summary.currentValue + cashBalance;
  const totalBenefit = portfolio.summary.totalBenefit + interest.total;

  const handleBankChange = (value: string) => {
    setBank(value as BankId);
    setFeedback(null);
  };

  const handleImport = async () => {
    const input = fileInputRef.current;
    const selected = input?.files ? Array.from(input.files) : [];
    if (selected.length === 0) {
      setFeedback({ kind: 'error', text: 'Selecciona al menos un fichero CSV o XLS.' });
      return;
    }

    setImporting(true);
    setFeedback(null);

    try {
      const newFiles: FileMeta[] = [];
      const fresh: Movement[] = [];
      let skippedRows = 0;
      let addedCount = 0;
      let duplicateCount = 0;
      const existingMap = buildConceptCategoryMap(store.movements);

      for (const file of selected) {
        const matrix = await readFileAsMatrix(file);
        const parsed = parseBankMatrix(bank, file.name, matrix);
        skippedRows += parsed.skipped;
        const fileId = hashId(`${bank}|${file.name}|${file.size}|${file.lastModified}`);
        newFiles.push({
          id: fileId,
          name: file.name,
          bank,
          count: parsed.movements.length,
          importedAt: new Date().toISOString(),
        });
        for (const m of parsed.movements) {
          fresh.push({
            ...m,
            fileId,
            category: m.category ?? resolveExpenseCategory(m.concept, store.movements),
            categoryAuto: true,
          });
        }
      }

      // Calcula el resultado con el estado actual (fuera del updater de React,
      // que puede ejecutarse después de decidir el mensaje de feedback).
      // Las órdenes se agrupan antes de comparar firmas para que coincidan con
      // las ya fusionadas en el histórico.
      const incoming = mergeSplitTrades(fresh);
      const existingSignatures = new Set(store.movements.map(movementSignature));
      const toAdd: Movement[] = [];
      for (const m of incoming) {
        const signature = movementSignature(m);
        if (existingSignatures.has(signature)) duplicateCount++;
        else {
          toAdd.push(m);
          existingSignatures.add(signature);
        }
      }
      addedCount = toAdd.length;

      setStore(prev => {
        const filesById = new Map(prev.files.map(f => [f.id, f]));
        for (const f of newFiles) filesById.set(f.id, f);
        return {
          files: [...filesById.values()],
          // Normaliza el conjunto combinado: colapsa pares ingreso-perk
          // heredados y deduplica contra lo ya almacenado.
          movements: normalizeStoredMovements([...prev.movements, ...toAdd]),
        };
      });

      if (addedCount === 0 && duplicateCount === 0) {
        setFeedback({
          kind: 'error',
          text: `No se ha podido leer ningún movimiento de "${selected.map(f => f.name).join(', ')}". Comprueba que el banco seleccionado coincide con el origen del fichero.`,
        });
      } else {
        const parts = [
          `${addedCount} movimiento${addedCount === 1 ? '' : 's'} importado${addedCount === 1 ? '' : 's'}`,
          `${duplicateCount} duplicado${duplicateCount === 1 ? '' : 's'} omitido${duplicateCount === 1 ? '' : 's'}`,
        ];
        if (skippedRows > 0) parts.push(`${skippedRows} filas sin fecha o importe ignoradas`);
        setFeedback({ kind: addedCount > 0 ? 'success' : 'warning', text: `${parts.join(' · ')}.` });
      }
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: `Error leyendo el fichero: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setImporting(false);
    }
  };

  const deleteFile = (fileId: string) => {
    setStore(prev => ({
      files: prev.files.filter(f => f.id !== fileId),
      movements: prev.movements.filter(m => m.fileId !== fileId),
    }));
  };

  const clearAll = () => {
    if (!window.confirm('¿Vaciar todos los movimientos e histórico de ficheros importados?')) return;
    setStore({ files: [], movements: [] });
    setPriceStatus(null);
    setFeedback(null);
  };

  const applyCategory = (movementIds: string[], category: string) => {
    setStore(prev => ({
      ...prev,
      movements: prev.movements.map(m =>
        movementIds.includes(m.id)
          ? { ...m, category, categoryAuto: false }
          : m
      ),
    }));
  };

  const updateCategory = (movementId: string, category: string) => {
    const target = store.movements.find(m => m.id === movementId);
    if (!target) return;
    const key = cleanConcept(target.concept);
    // Movimientos con el mismo concepto que se moverían juntos (los
    // reintegros de cajero no se reclasifican nunca por concepto).
    const sameConceptIds = store.movements
      .filter(m => key && cleanConcept(m.concept) === key)
      .map(m => m.id);
    if (sameConceptIds.length > 1) {
      setPendingCategoryChange({
        movementId,
        category,
        ids: sameConceptIds,
        concept: cleanConcept(target.concept),
      });
    } else {
      applyCategory([movementId], category);
    }
  };

  const confirmMoveAll = () => {
    if (!pendingCategoryChange) return;
    applyCategory(pendingCategoryChange.ids, pendingCategoryChange.category);
    setPendingCategoryChange(null);
  };

  const confirmMoveOne = () => {
    if (!pendingCategoryChange) return;
    applyCategory([pendingCategoryChange.movementId], pendingCategoryChange.category);
    setPendingCategoryChange(null);
  };

  const bulkUpdateCategory = (movementIds: string[], category: string) => {
    if (movementIds.length === 0) return;
    applyCategory(movementIds, category);
  };

  const applyType = (movementIds: string[], type: MovementType) => {
    setStore(prev => ({
      ...prev,
      movements: prev.movements.map(m =>
        movementIds.includes(m.id)
          ? { ...m, type }
          : m
      ),
    }));
  };

  const updateType = (movementId: string, type: MovementType) => {
    const target = store.movements.find(m => m.id === movementId);
    if (!target) return;
    const key = cleanConcept(target.concept);
    // Movimientos con el mismo concepto que se moverían juntos (los
    // reintegros de cajero no se reclasifican nunca por concepto).
    const sameConceptIds = store.movements
      .filter(m => key && cleanConcept(m.concept) === key)
      .map(m => m.id);
    if (sameConceptIds.length > 1) {
      setPendingTypeChange({
        movementId,
        type,
        ids: sameConceptIds,
        concept: cleanConcept(target.concept),
      });
    } else {
      applyType([movementId], type);
    }
  };

  const confirmTypeAll = () => {
    if (!pendingTypeChange) return;
    applyType(pendingTypeChange.ids, pendingTypeChange.type);
    setPendingTypeChange(null);
  };

  const confirmTypeOne = () => {
    if (!pendingTypeChange) return;
    applyType([pendingTypeChange.movementId], pendingTypeChange.type);
    setPendingTypeChange(null);
  };

  const bulkUpdateType = (movementIds: string[], type: MovementType) => {
    if (movementIds.length === 0) return;
    applyType(movementIds, type);
  };

  const setManualPrice = (holdingKey: string, ticker: string | undefined, raw: string) => {
    setPriceMap(prev => {
      const next = { ...prev };
      const keys = [holdingKey, ...(ticker ? [ticker] : [])];
      const parsed = Number.parseFloat(raw.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        for (const k of keys) delete next[k];
      } else {
        next[holdingKey] = { value: parsed, source: 'manual' };
      }
      return next;
    });
  };

  const setPlazoConfig = (holdingKey: string, partial: Partial<PlazoFijoConfig>) => {
    setPlazoConfigs(prev => {
      const current = prev[holdingKey] ?? { rate: 0, months: 0 };
      const merged = { ...current, ...partial };
      const rate = Number(merged.rate) || 0;
      const months = Number(merged.months) || 0;
      const next = { ...prev };
      if (rate > 0 || months > 0) next[holdingKey] = { rate, months };
      else delete next[holdingKey];
      return next;
    });
  };

  const handleUpdatePrices = async () => {
    const requests: PriceRequest[] = portfolio.holdings
      .filter(h => h.assetClass !== 'plazo-fijo')
      .map(h => ({
        key: h.key,
        ticker: h.ticker,
        isin: h.isin,
      }));
    if (requests.length === 0) {
      setPriceStatus('No hay posiciones en la cartera.');
      return;
    }
    const labelByKey = new Map(
      portfolio.holdings.map(h => [h.key, h.ticker ?? h.isin ?? h.name])
    );
    setUpdatingPrices(true);
    setPriceStatus(null);
    try {
      const outcome = await fetchPrices(requests);
      setPriceMap(prev => {
        const next = { ...prev };
        const byKey = new Map(portfolio.holdings.map(h => [h.key, h]));
        for (const [key, value] of Object.entries(outcome.fetched)) {
          next[key] = { value, source: 'auto' };
          // Índices alternativos para reutilizar el precio entre posiciones.
          const h = byKey.get(key);
          if (h?.ticker) next[h.ticker] = { value, source: 'auto' };
          if (h?.isin) next[h.isin] = { value, source: 'auto' };
        }
        return next;
      });
      const okCount = Object.keys(outcome.fetched).length;
      const failedLabels = outcome.failed
        .map(key => labelByKey.get(key) ?? key)
        .join(', ');
      setPriceStatus(
        okCount > 0
          ? `${okCount} de ${requests.length} precios actualizados${failedLabels ? ` · Sin datos: ${failedLabels}` : ''}`
          : 'No se han podido obtener precios. Introdúcelos manualmente.'
      );
    } catch {
      setPriceStatus('Error al conectar con el servicio de cotizaciones. Introdúcelos manualmente.');
    } finally {
      setUpdatingPrices(false);
    }
  };

  const filteredMovements = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Eliminar compras/ventas duplicadas: cuando un movimiento de fondos
    // (fundOperation) coincide en fecha + importe con un movimiento de cuenta,
    // solo mostramos el de cuenta (el negativo).
    const accountKeys = new Set(
      store.movements
        .filter(m => m.type === 'buy' && !m.fundOperation)
        .map(m => `${m.date}|${Math.abs(m.amount)}`)
    );
    return store.movements
      .filter(m => {
        if (m.type === 'buy' && m.fundOperation) {
          if (accountKeys.has(`${m.date}|${Math.abs(m.amount)}`)) return false;
        }
        return true;
      })
      .filter(m => (movementFilter === 'all' ? true : m.type === movementFilter))
      .filter(m =>
        q.length === 0 ||
        m.concept.toLowerCase().includes(q) ||
        (m.ticker ?? '').toLowerCase().includes(q) ||
        (m.isin ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [store.movements, movementFilter, search]);

  const presentTypes = useMemo(() => {
    const types = new Set<MovementType>();
    for (const m of store.movements) types.add(m.type);
    return [...types];
  }, [store.movements]);

  // Orden por defecto por % Anual: solo se recalcula cuando cambia la
  // composición de la cartera (entra o sale un producto), nunca al editar los
  // precios o valores actuales, para que la tabla no se reordene bajo el cursor.
  const holdingsCompositionKey = portfolio.holdings.map(h => h.key).join('|');
  const orderedHoldings = useMemo(() => {
    const sortValue = (h: Holding) => annualizedGainRatio(h) ?? Number.NEGATIVE_INFINITY;
    return [...portfolio.holdings].sort(
      (a, b) =>
        sortValue(b) - sortValue(a) || // % Anual descendente (no anualizables al final)
        b.value - a.value ||
        a.name.localeCompare(b.name)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsCompositionKey]);

  const holdingsWithSource = useMemo(() => {
    return orderedHoldings.map(h => ({
      holding: h,
      entry:
        priceMap[h.key] ??
        (h.ticker && priceMap[h.ticker]) ??
        (h.isin && priceMap[h.isin]) ??
        null,
    }));
  }, [orderedHoldings, priceMap]);

  return (
    <SimulatorLayout>
      <FormContainer>
        <FormSection title="Importar extractos bancarios" cols="single">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Banco de origen</span>
              <select
                value={bank}
                onChange={e => handleBankChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
              >
                {BANKS.map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
              <span className="block text-xs text-gray-500 mt-1">
                {BANKS.find(b => b.id === bank)?.hint}
              </span>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Ficheros (CSV/XLS)</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xls,.xlsx,text/csv,text/plain"
                multiple
                className="w-full text-sm text-gray-600 file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-gray-900 file:text-white file:text-sm file:font-semibold file:cursor-pointer hover:file:bg-gray-700 cursor-pointer"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? 'Importando…' : '📥 Importar movimientos'}
            </button>
            {feedback && (
              <p className={`text-xs leading-relaxed ${
                feedback.kind === 'success' ? 'text-emerald-700'
                  : feedback.kind === 'warning' ? 'text-amber-700'
                  : 'text-red-700'
              }`}>
                {feedback.text}
              </p>
            )}
          </div>

          {store.files.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Histórico de ficheros ({store.files.length})
                </h4>
                <button
                  type="button"
                  onClick={clearAll}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                  Vaciar todo
                </button>
              </div>
              <ul className="flex flex-wrap gap-2">
                {store.files.map(f => (
                  <li
                    key={f.id}
                    className="inline-flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-xs text-gray-700 max-w-full"
                  >
                    <span className="font-semibold">{BANK_LABELS[f.bank]}</span>
                    <span className="truncate max-w-[180px]">{f.name}</span>
                    <span className="text-gray-400">{f.count} mov.</span>
                    <Tooltip text="Eliminar fichero y sus movimientos">
                      <button
                        type="button"
                        onClick={() => deleteFile(f.id)}
                        aria-label="Eliminar fichero y sus movimientos"
                        className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                      >
                        ✕
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FormSection>
      </FormContainer>

      <ResultsContainer>
        {!hasData ? (
          <div className="py-14 flex flex-col items-center justify-center text-center gap-3">
            <span className="text-4xl">📊</span>
            <p className="text-base font-bold text-gray-900">Aún no hay datos</p>
            <p className="text-sm text-gray-500 max-w-md leading-relaxed">
              Sube los extractos CSV/XLS de tus bancos para ver el beneficio de tu cartera,
              los intereses de cuentas remuneradas y un seguimiento mensual de tus gastos.
              Todo se guarda únicamente en tu navegador.
            </p>
          </div>
        ) : (
          <>
            <ScenarioSection gridCols="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <SummaryCard
                label="Capital Total"
                value={formatCurrency(totalCapital)}
                variant="info"
                subtitle={capitalSplitSubtitle(portfolio.summary.currentValue, cashBalance)}
              />
              <SummaryCard
                label="Beneficio Total"
                value={`${signedAmount(totalBenefit)} (${totalBenefit > 0 ? '+' : ''}${((totalBenefit / totalCapital) * 100).toFixed(2)}%)`}
                variant={
                  totalBenefit > 0.005 ? 'positive' : totalBenefit < -0.005 ? 'negative' : 'neutral'
                }
                subtitle={`Cartera ${signedAmount(portfolio.summary.totalBenefit)} · Cuenta ${signedAmount(interest.total)}`}
              />
              <SummaryCard label="Gasto Medio Mensual" value={formatCurrency(expenses.averageMonthly)} variant="info" />
            </ScenarioSection>

            <div className="-mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200 pt-5 space-y-5">
              <div className="flex flex-wrap gap-2">
                {SECTION_TABS.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`px-4 py-2 text-sm font-semibold rounded-full border transition-colors cursor-pointer ${
                      tab === t.id
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'portfolio' && (
                <PortfolioSection
                  rows={holdingsWithSource}
                  summary={portfolio.summary}
                  plazoConfigs={plazoConfigs}
                  updating={updatingPrices}
                  status={priceStatus}
                  onUpdatePrices={handleUpdatePrices}
                  onSetPrice={setManualPrice}
                  onSetPlazoConfig={setPlazoConfig}
                />
              )}

              {tab === 'account' && (
                <AccountSection data={interest} account={account} cashBalance={cashBalance} bankBreakdown={bankBreakdown} />
              )}

              {tab === 'income' && (
                <IncomeSection
                  income={income}
                  expAvg={expenses.averageMonthly}
                  expCurrent={expenses.currentMonth}
                  expPrev={expenses.previousMonth}
                  expMonthly={expenses.monthly}
                  movements={store.movements.filter(m => m.type === 'income')}
                />
              )}

              {tab === 'expenses' && (
                <ExpensesSection
                  data={expenses}
                  movements={store.movements.filter(m => m.type === 'expense' || m.type === 'refund')}
                  onChangeCategory={updateCategory}
                  onBulkChangeCategory={bulkUpdateCategory}
                />
              )}

              {tab === 'movements' && (
                <MovementsSection
                  movements={filteredMovements}
                  total={filteredMovements.length}
                  types={presentTypes}
                  filter={movementFilter}
                  search={search}
                  onFilterChange={setMovementFilter}
                  onSearchChange={setSearch}
                  onChangeType={updateType}
                  onBulkChangeType={bulkUpdateType}
                />
              )}
            </div>
          </>
        )}
        <NoteCard variant="info" >
          🔒 Todos los datos se procesan y almacenan localmente en tu navegador.
          Nada se envía a ningún servidor.
        </NoteCard>
      </ResultsContainer>

      <Modal
        open={pendingCategoryChange !== null}
        onClose={() => setPendingCategoryChange(null)}
        title="Cambiar categoría"
      >
        <p className="text-sm text-gray-700 leading-relaxed">
          Se han encontrado{' '}
          <span className="font-semibold text-gray-900">{pendingCategoryChange?.ids.length ?? 0}</span>{' '}
          movimientos con el concepto «{pendingCategoryChange?.concept}».
        </p>
        <p className="text-sm text-gray-700 leading-relaxed mt-2">
          ¿Quieres moverlos todos a la categoría{' '}
          <span className="font-semibold text-gray-900">{pendingCategoryChange?.category}</span>{' '}
          o solo este movimiento?
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={confirmMoveOne}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            Solo este
          </button>
          <button
            type="button"
            onClick={confirmMoveAll}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Mover todos ({pendingCategoryChange?.ids.length})
          </button>
        </div>
      </Modal>

      <Modal
        open={pendingTypeChange !== null}
        onClose={() => setPendingTypeChange(null)}
        title="Cambiar tipo"
      >
        <p className="text-sm text-gray-700 leading-relaxed">
          Se han encontrado{' '}
          <span className="font-semibold text-gray-900">{pendingTypeChange?.ids.length ?? 0}</span>{' '}
          movimientos con el concepto «{pendingTypeChange?.concept}».
        </p>
        <p className="text-sm text-gray-700 leading-relaxed mt-2">
          ¿Quieres cambiar el tipo de todos a{' '}
          <span className="font-semibold text-gray-900">
            {pendingTypeChange ? MOVEMENT_TYPE_LABELS[pendingTypeChange.type] : ''}
          </span>{' '}
          o solo este movimiento?
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={confirmTypeOne}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            Solo este
          </button>
          <button
            type="button"
            onClick={confirmTypeAll}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Cambiar todos ({pendingTypeChange?.ids.length})
          </button>
        </div>
      </Modal>
    </SimulatorLayout>
  );
}

// ---------------------------------------------------------------------------
// Cartera
// ---------------------------------------------------------------------------

function PortfolioSection({
  rows,
  summary,
  plazoConfigs,
  updating,
  status,
  onUpdatePrices,
  onSetPrice,
  onSetPlazoConfig,
}: {
  rows: Array<{ holding: Holding; entry: PriceEntry | null }>;
  summary: ReturnType<typeof computePortfolio>['summary'];
  plazoConfigs: Record<string, PlazoFijoConfig>;
  updating: boolean;
  status: string | null;
  onUpdatePrices: () => void;
  onSetPrice: (key: string, ticker: string | undefined, raw: string) => void;
  onSetPlazoConfig: (key: string, partial: Partial<PlazoFijoConfig>) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-6 text-center">
        No hay compras de ETFs, acciones o fondos en los extractos importados.
      </p>
    );
  }

  return (
    <section className="space-y-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="py-2 text-base font-bold text-gray-900 uppercase tracking-wider">
          Evolución de la cartera ({rows.length} productos)
        </h3>
        {/*<div className="flex items-center gap-3">
          {status && <p className="text-xs text-gray-500 max-w-[320px] text-right">{status}</p>}
          <button
            type="button"
            onClick={onUpdatePrices}
            disabled={updating}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {updating ? 'Actualizando…' : '🔄 Actualizar precios'}
          </button>
        </div>*/}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <SummaryCard label="Invertido" value={formatCurrency(summary.investedCost)} variant="info" />
        <SummaryCard label="Valor Actual" value={formatCurrency(summary.currentValue)} variant="info" subtitle={`${summary.currentValue - summary.investedCost > 0 ? '+' : ''}${((summary.currentValue - summary.investedCost) / summary.investedCost * 100).toFixed(2)}%`} />
        <SummaryCard label="Latente" value={signedAmount(summary.unrealized)} variant={summary.unrealized >= 0 ? 'positive' : 'negative'} subtitle="Pendiente de vender" />
        <SummaryCard label="Recibido" value={signedAmount(summary.realized)} variant={summary.realized >= 0 ? 'positive' : 'negative'} subtitle="Ventas" />
        <SummaryCard label="Dividendos" value={signedAmount(summary.dividends)} subtitle={undefined} />
      </div>

      <ScrollableTable
        columns={[
          { title: 'Producto', align: 'left' },
          { title: 'Tipo', align: 'left' },
          //{ title: 'Días' },
          { title: 'Partic.' },
          { title: 'P. medio' },
          { title: 'P. actual', align: 'left' },
          { title: 'TIR %' },
          { title: 'Duración' },
          { title: 'Invertido' },
          { title: 'Valor' },
          { title: 'Latente' },
          { title: 'Recibido' },
          { title: 'Dividendos' },
          { title: 'Total' },
          { title: '% Anual' },
        ]}
        rows={rows.map(({ holding: h, entry }) => {
          const pct = h.investedCost > 0 ? (h.totalPnl / h.investedCost) * 100 : null;
          const daysHeld = h.firstBuyDate
            ? Math.max(0, Math.floor((Date.now() - new Date(`${h.firstBuyDate}T00:00:00`).getTime()) / 86400000))
            : null;
          const isPF = h.assetClass === 'plazo-fijo';
          const plazoCfg = isPF ? plazoConfigs[h.key] : undefined;
          // Producto sin capital pendiente: plazo vencido o posición vendida del todo.
          const hasValue = h.investedCost > 0;
          return [
            {
              content: (
                <div className="min-w-[140px]">
                  <p className="font-semibold text-gray-900 truncate max-w-[220px]">{h.name}</p>
                  {(h.ticker || h.isin) && (
                    <p className="text-xs text-gray-400">{h.ticker ?? h.isin}</p>
                  )}
                </div>
              ),
            },
            { content: <span className="text-gray-600">{investmentTypeLabel(h.assetClass)}</span> },
            /*daysHeld !== null
              ? { content: <span className="text-gray-500" title={`Primera compra: ${h.firstBuyDate}`}>{daysHeld.toLocaleString('es-ES')}</span> }
              : '—',*/
            !hasValue ? '—' : (isPF ? '—' : formatQuantity(h.shares)),
            !hasValue ? '—' : (isPF ? '—' : formatCurrency(h.avgPrice)),
            !hasValue
              ? '—'
              : isPF
                ? '—'
                : {
                    content: (
                      <Tooltip
                        text={
                          entry
                            ? `Precio ${entry.source === 'auto' ? 'obtenido automáticamente' : 'introducido manualmente'}`
                            : 'Sin precio guardado; se usa el precio medio'
                        }
                      >
                        <input
                          type="number"
                          step="any"
                          min="0"
                          aria-label={`Precio actual de ${h.name}`}
                          value={entry?.value ?? ''}
                          placeholder={h.avgPrice.toFixed(2)}
                          onChange={e => onSetPrice(h.key, h.ticker, e.target.value)}
                          className="w-24 px-2 py-1 border border-gray-200 rounded-md text-sm text-right text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                        />
                      </Tooltip>
                    ),
                  },
            isPF && h.investedCost > 0
              ? {
                  content: (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      aria-label={`TIR anual de ${h.name}`}
                      value={plazoCfg?.rate ? String(plazoCfg.rate) : ''}
                      placeholder="% anual"
                      onChange={e => onSetPlazoConfig(h.key, { rate: Number.parseFloat(e.target.value.replace(',', '.')) })}
                      className="w-20 px-2 py-1 border border-gray-200 rounded-md text-sm text-right text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                    />
                  ),
                }
              : '—',
            isPF && h.investedCost > 0
              ? {
                  content: (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      aria-label={`Duración de ${h.name}`}
                      value={plazoCfg?.months ? String(plazoCfg.months) : ''}
                      placeholder="meses"
                      onChange={e => onSetPlazoConfig(h.key, { months: Number.parseFloat(e.target.value.replace(',', '.')) })}
                      className="w-20 px-2 py-1 border border-gray-200 rounded-md text-sm text-right text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                    />
                  ),
                }
              : '—',
            !hasValue ? '—' : formatCurrency(h.investedCost),
            !hasValue ? '—' : formatCurrency(h.value),
            !hasValue
              ? '—'
              : {
                  content: (
                    <Tooltip
                      text={
                        isPF && h.plazoProjectedGain !== undefined
                          ? `Ganancia prevista al vencimiento: ${formatCurrency(h.investedCost)} × ${formatPct(h.plazoRate ?? 0).replace('+', '')} / 12 × ${h.plazoMonths ?? 0} meses = ${formatCurrency(h.plazoProjectedGain)}${h.realizedPnl > 0 ? `, menos ${formatCurrency(h.realizedPnl)} ya cobrados` : ''}.`
                          : isPF
                            ? 'Indica la TIR % y la duración del plazo para estimar la ganancia al vencimiento.'
                            : 'Diferencia entre el valor actual y el invertido (pendiente de vender).'
                      }
                    >
                      <span className={pnlColor(h.unrealizedPnl)}>{signedAmount(h.unrealizedPnl)}</span>
                    </Tooltip>
                  ),
                },
            { content: <span className={pnlColor(h.realizedPnl)}>{signedAmount(h.realizedPnl)}</span> },
            { content: <span className="text-gray-600">{isPF ? '—' : signedAmount(h.dividends)}</span> },
            {
              content: (
                <span className={pnlColor(h.totalPnl)}>
                  {signedAmount(h.totalPnl)}
                  {pct !== null && (
                    <span className={`block text-xs font-normal ${pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                    </span>
                  )}
                </span>
              ),
            },
            annualizedGainCell(h),
          ];
        })}
      />
      <p className="text-xs text-gray-400 -mt-2">
        El precio actual es editable: sin dato guardado se usa el precio medio de compra.
        La columna «% Anual» anualiza la subida total desde la primera compra; si aún no ha pasado
        un año (*), muestra la subida actual sin anualizar.
        En los plazos fijos, la TIR % y la duración que indiques estiman en «Latente»
        la ganancia prevista al vencimiento y marcan «% Anual» con la TIR del plazo.
      </p>
    </section>
  );
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 8 }).format(value);
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** Días transcurridos desde una fecha ISO hasta hoy. */
function daysSince(dateIso: string): number {
  const msPerDay = 86400000;
  return Math.max(0, Math.floor((Date.now() - new Date(`${dateIso}T00:00:00`).getTime()) / msPerDay));
}

/**
 * Subida anualizada (CAGR) en tanto por uno desde la primera compra hasta hoy,
 * sobre el % de subida total (beneficio total / coste pendiente). Con menos de
 * un año de histórico no hay base para anualizar y se devuelve la subida
 * actual; null si no es calculable o la posición ha perdido más del 100 %.
 */
function annualizedGainRatio(h: Holding): number | null {
  if (!h.firstBuyDate || h.investedCost <= 0) return null;
  const totalRatio = 1 + h.totalPnl / h.investedCost;
  if (totalRatio <= 0) return null;
  const years = daysSince(h.firstBuyDate) / 365.25;
  return years < 1 ? h.totalPnl / h.investedCost : Math.pow(totalRatio, 1 / years) - 1;
}

/**
 * Celda de «% Anual»: subida anualizada del producto; con menos de un año
 * muestra la subida actual marcada con un asterisco y explicada en el tooltip.
 * En depósitos a plazo muestra la TIR anual indicada por el usuario.
 */
function annualizedGainCell(h: Holding): { content: ReactNode } | string {
  if (h.assetClass === 'plazo-fijo') {
    if (!h.plazoRate || h.investedCost <= 0) {
      return {
        content: (
          <Tooltip text="Indica la TIR % y la duración del plazo para ver su rentabilidad anual.">
            <span className="text-gray-500">—</span>
          </Tooltip>
        ),
      };
    }
    return {
      content: (
        <Tooltip text={`TIR anual del plazo fijo (${h.plazoMonths ?? 0} meses): ${formatPct(h.plazoRate)}.`}>
          <span className={pnlColor(h.plazoRate)}>{formatPct(h.plazoRate)}</span>
        </Tooltip>
      ),
    };
  }

  if (!h.firstBuyDate || h.investedCost <= 0) return '—';
  const totalPct = (h.totalPnl / h.investedCost) * 100;
  const days = daysSince(h.firstBuyDate);
  const years = days / 365.25;

  if (years < 1) {
    return {
      content: (
        <Tooltip text={`Primera compra el ${h.firstBuyDate}: aún no cumple 1 año, se muestra la subida actual (${formatPct(totalPct)}) sin anualizar.`}>
          <span className={pnlColor(totalPct)}>
            {formatPct(totalPct)}
          </span>
        </Tooltip>
      ),
    };
  }

  // CAGR indefinido si la posición ha perdido más del 100 %
  if (totalPct <= -100) {
    return {
      content: (
        <Tooltip text={`Subida total ${formatPct(totalPct)} desde ${h.firstBuyDate}: no anualizable.`}>
          <span className="text-gray-500">—</span>
        </Tooltip>
      ),
    };
  }

  const cagr = (Math.pow(1 + totalPct / 100, 1 / years) - 1) * 100;
  return {
    content: (
      <Tooltip text={`Subida total ${formatPct(totalPct)} desde la primera compra (${h.firstBuyDate}, ${days.toLocaleString('es-ES')} días), anualizada en ${years.toFixed(1)} años.`}>
        <span className={pnlColor(cagr)}>{formatPct(cagr)}</span>
      </Tooltip>
    ),
  };
}

/** Etiqueta del tipo de inversión a partir de la clase de activo del banco. */
function investmentTypeLabel(assetClass: string | undefined): string {
  if (!assetClass) return '—';
  const t = assetClass.toUpperCase();
  if (/PLAZO.?FIJO/.test(t)) return 'Plazo Fijo';
  if (/FUND|ETF/.test(t)) return 'ETF';
  if (/STOCK|ACCI|EQUITY|SHARE/.test(t)) return 'Acción';
  if (/SUSCRIP|REEMBOLSO|TRASPASO|FUSION|FONDO/.test(t)) return 'Fondo';
  if (/BOND|BONO|RENTA FIJA/.test(t)) return 'Bono';
  if (/CRYPTO|CRIPTO/.test(t)) return 'Cripto';
  if (/COMMODIT|METAL|GOLD|\bOR\b/.test(t)) return 'Materia prima';
  return assetClass;
}

// ---------------------------------------------------------------------------
// Cuenta
// ---------------------------------------------------------------------------

function AccountSection({
  data,
  account,
  cashBalance,
  bankBreakdown,
}: {
  data: ReturnType<typeof computeInterest>;
  account: ReturnType<typeof computeAccountEvolution>;
  cashBalance: number;
  bankBreakdown: BankBreakdownEntry[];
}) {
  if (account.evolution.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-6 text-center">
        No se han detectado ingresos ni abonos de interés en los extractos importados.
      </p>
    );
  }

  return (
    <section className="space-y-4 pb-6">
      <h3 className="py-2 text-base font-bold text-gray-900 uppercase tracking-wider">Evolución de la cuenta</h3>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <SummaryCard
          label="Efectivo en Cuenta"
          value={formatCurrency(cashBalance)}
          variant="info"
          subtitle={`+${((cashBalance/(cashBalance - account.totalInterest) - 1) * 100).toFixed(2)}%`}
        />
        <SummaryCard
          label="Intereses Netos"
          value={formatCurrency(account.totalInterest)}
          variant={account.totalInterest > 0 ? 'positive' : 'neutral'}
          subtitle={`${data.monthly.length} meses de histórico`}
          /*subtitle={
            data.withheld > 0
              ? `${formatCurrency(data.gross)} − ${formatCurrency(data.withheld)} en retenciones`
              : undefined
          }*/ // TODO: Calcular data.gross y data.withheld correctamente con myinvestor también
        />
        <SummaryCard
          label={`Intereses Año en Curso`}
          value={formatCurrency(data.currentYear)}
          variant="info"
        />
      </div>

      {bankBreakdown.length > 1 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-8">Saldo por cuenta</h4>
          <ScrollableTable
            columns={[
              { title: 'Banco', align: 'left' },
              { title: 'Invertido' },
              { title: 'Saldo' },
              { title: 'Intereses' },
            ]}
            rows={bankBreakdown.map(b => [
              { content: <span className="font-semibold text-gray-900">{BANK_LABELS[b.bank as BankId] ?? b.bank}</span> },
              { content: <span className={b.balance >= 0 ? 'text-gray-900' : 'text-red-600'}>{formatCurrency(b.balance - b.interest)}</span> },
              { content: <span className={b.balance >= 0 ? 'text-gray-900' : 'text-red-600'}>{formatCurrency(b.balance)}</span> },
              { content: <span className={b.interest > 0 ? 'text-emerald-600 font-semibold' : 'text-gray-500'}>{formatCurrency(b.interest)}</span> },
            ])}
          />
        </div>
      )}

      {/*<div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Evolución del dinero en la cuenta (ingresos + intereses)
        </h4>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={evolutionChartData(account.evolution)} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} width={70} tickFormatter={v => `${v} €`} />
            {accountTooltip()}
            <Line
              type="monotone"
              dataKey="total"
              name="En cuenta"
              stroke="#059669"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ScrollableTable
        columns={[
          { title: 'Año', align: 'left' },
          { title: 'Aportado' },
          { title: 'Intereses netos' },
        ]}
        rows={yearlyAccountRows(account.evolution)}
      />*/}
    </section>
  );
}

function evolutionChartData(points: AccountEvolutionPoint[]) {
  return points.map(p => ({
    ...p,
    total: p.contributed + p.interest,
    label: fmtMonthLabel(p.month),
  }));
}

function yearlyAccountRows(points: AccountEvolutionPoint[]): Array<Array<ReactNode | { content: ReactNode; className?: string }>> {
  const byYear = new Map<string, { contributed: number; interest: number }>();
  let prevContributed = 0;
  let prevInterest = 0;
  for (const p of points) {
    const year = p.month.slice(0, 4);
    const entry = byYear.get(year) ?? { contributed: 0, interest: 0 };
    entry.contributed += p.contributed - prevContributed;
    entry.interest += p.interest - prevInterest;
    byYear.set(year, entry);
    prevContributed = p.contributed;
    prevInterest = p.interest;
  }
  return [...byYear.entries()].map(([year, totals]) => [
    year,
    formatCurrency(totals.contributed),
    {
      content: (
        <span className={totals.interest > 0 ? 'text-emerald-600 font-semibold' : ''}>
          {formatCurrency(totals.interest)}
        </span>
      ),
    },
  ]);
}

function accountTooltip() {
  return (
    <RechartsTooltip
      cursor={{ stroke: '#d1d5db' }}
      content={
        <ChartTooltip
          renderContent={payload => {
            const point = payload[0]?.payload as
              | { label?: string; contributed?: number; interest?: number; total?: number }
              | undefined;
            const contributed = point?.contributed ?? 0;
            const interest = point?.interest ?? 0;
            return (
              <>
                <p className="font-semibold text-gray-900">{point?.label ?? ''}</p>
                <p style={{ color: '#6b7280' }}>Ingresos: {formatCurrency(contributed)}</p>
                <p style={{ color: '#059669' }}>Intereses: {formatCurrency(interest)}</p>
                <p className="font-semibold text-gray-900 border-t border-gray-200 mt-1 pt-1">
                  En cuenta: {formatCurrency(point?.total ?? contributed + interest)}
                </p>
              </>
            );
          }}
        />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Ingresos
// ---------------------------------------------------------------------------

function IncomeSection({
  income,
  expAvg,
  expCurrent,
  expPrev,
  expMonthly,
  movements,
}: {
  income: ReturnType<typeof computeIncome>;
  expAvg: number;
  expCurrent: number;
  expPrev: number;
  expMonthly: Array<{ month: string; total: number }>;
  movements: Movement[];
}) {
  const savingsAvg = income.averageMonthly - expAvg;
  const savingsCurrent = income.currentMonth - expCurrent;
  const savingsPrev = income.previousMonth - expPrev;
  const chartData = monthlyChartData(monthlyExpenseSlice(income.monthly));

  const { incomeMedian, savingsMedian } = useMemo(() => {
    const expByMonth = new Map(expMonthly.map(p => [p.month, p.total]));
    const savingsByMonth = income.monthly.map(p => p.total - (expByMonth.get(p.month) ?? 0));
    return {
      incomeMedian: median(income.monthly.map(p => p.total)),
      savingsMedian: median(savingsByMonth),
    };
  }, [income.monthly, expMonthly]);

  const sorted = useMemo(
    () => [...movements].sort((a, b) => b.date.localeCompare(a.date)),
    [movements]
  );
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sorted.length / INCOME_PAGE_SIZE));
  const shown = sorted.slice((page - 1) * INCOME_PAGE_SIZE, page * INCOME_PAGE_SIZE);
  useEffect(() => setPage(1), [movements]);

  return (
    <section className="space-y-4 pb-6">
      <h3 className="py-2 text-base font-bold text-gray-900 uppercase tracking-wider">Ingresos</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Ingreso Medio Mensual" value={formatCurrency(income.averageMonthly)} variant="info" subtitle={`Mediana: ${formatCurrency(incomeMedian)} · ${income.monthCount} meses`} />
        <SummaryCard
          label="Capacidad de Ahorro Media"
          value={formatCurrency(savingsAvg)}
          variant={savingsAvg >= 0 ? 'positive' : 'negative'}
          subtitle={`Mediana: ${formatCurrency(savingsMedian)}`}
        />
        <SummaryCard
          label="Mes Actual"
          value={formatCurrency(income.currentMonth)}
          variant="neutral"
          subtitle={
            <span>
              Capacidad de ahorro:{' '}
              <span className={`font-semibold ${savingsCurrent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(savingsCurrent)}
              </span>
            </span>
          }
        />
        <SummaryCard
          label="Mes Anterior"
          value={formatCurrency(income.previousMonth)}
          variant="neutral"
          subtitle={
            <span>
              Capacidad de ahorro:{' '}
              <span className={`font-semibold ${savingsPrev >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(savingsPrev)}
              </span>
            </span>
          }
        />
      </div>

      <div>
        <div className="flex items-center gap-3 mb-2 mt-8">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Ingresos por mes</h4>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} width={70} tickFormatter={v => `${v} €`} />
            {monthTooltipRecharts()}
            <Bar dataKey="total" fill="#059669" radius={[3, 3, 0, 0]} name="Ingresos" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 my-4 mt-8">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Detalle de ingresos</h4>
        </div>
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
          {shown.map(m => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-gray-800 truncate">{m.concept}</p>
                <p className="text-xs text-gray-400">
                  {new Date(`${m.date}T00:00:00`).toLocaleDateString('es-ES')} · {BANK_LABELS[m.bank]}
                </p>
              </div>
              <span className="text-emerald-700 font-semibold whitespace-nowrap">{formatCurrency(Math.abs(m.amount))}</span>
            </li>
          ))}
        </ul>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

function ExpensesSection({
  data,
  movements,
  onChangeCategory,
  onBulkChangeCategory,
}: {
  data: ReturnType<typeof computeExpenses>;
  movements: Movement[];
  onChangeCategory: (id: string, category: string) => void;
  onBulkChangeCategory: (ids: string[], category: string) => void;
}) {
  const [expPage, setExpPage] = useState(1);
  const [expCategory, setExpCategory] = useState<string>('all');
  const [expSearch, setExpSearch] = useState('');
  const [expSortKey, setExpSortKey] = useState<'date' | 'amount'>('date');
  const [expSortDir, setExpSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chartCategory, setChartCategory] = useState<string>('all');

  const last12Avg = useMemo(() => {
    const last = data.monthly.slice(-12);
    if (last.length === 0) return 0;
    return last.reduce((sum, p) => sum + p.total, 0) / last.length;
  }, [data.monthly]);

  const last12ByCategory = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [cat, series] of Object.entries(data.monthlyByCategory)) {
      const last = series.slice(-12);
      const sum = last.reduce((s, p) => s + p.total, 0);
      out[cat] = last.length > 0 ? sum / last.length : 0;
    }
    return out;
  }, [data.monthlyByCategory]);

  const filteredMovements = useMemo(() => {
    const q = expSearch.trim().toLowerCase();
    return movements
      .filter(m => expCategory === 'all' || (m.category ?? 'Otros') === expCategory)
      .filter(m => q.length === 0 || m.concept.toLowerCase().includes(q));
  }, [movements, expCategory, expSearch]);

  const sortedMovements = useMemo(() => {
    const dir = expSortDir === 'asc' ? 1 : -1;
    const list = [...filteredMovements];
    if (expSortKey === 'amount') {
      const signed = (m: Movement) => (m.type === 'refund' ? -1 : 1) * Math.abs(m.amount);
      list.sort((a, b) => (signed(a) - signed(b)) * dir);
    } else {
      list.sort((a, b) => a.date.localeCompare(b.date) * dir);
    }
    return list;
  }, [filteredMovements, expSortKey, expSortDir]);

  const expTotalPages = Math.max(1, Math.ceil(sortedMovements.length / PAGE_SIZE));
  const expShown = sortedMovements.slice((expPage - 1) * PAGE_SIZE, expPage * PAGE_SIZE);

  useEffect(() => setExpPage(1), [expCategory, expSearch, expSortKey, expSortDir]);
  useEffect(() => setSelected(new Set()), [movements]);

  const toggleSort = (key: 'date' | 'amount') => {
    if (expSortKey === key) {
      setExpSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setExpSortKey(key);
      setExpSortDir('desc');
    }
  };
  useEffect(() => setSelected(new Set()), [movements]);

  // Al cambiar filtro, búsqueda u ordenación se mantienen solo las selecciones
  // que siguen visibles en el resultado filtrado.
  useEffect(() => {
    const visible = new Set(sortedMovements.map(m => m.id));
    setSelected(prev => new Set([...prev].filter(id => visible.has(id))));
  }, [sortedMovements]);

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => {
      const currentIds = expShown.map(m => m.id);
      const allSelected = currentIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) for (const id of currentIds) next.delete(id);
      else for (const id of currentIds) next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const applyBulk = (category: string) => {
    if (selected.size === 0) return;
    onBulkChangeCategory([...selected], category);
    clearSelection();
  };

  if (movements.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-6 text-center">
        No se han detectado gastos (tarjetas, recibos, comercios…) en los extractos importados.
      </p>
    );
  }

  const shownAllSelected = expShown.length > 0 && expShown.every(m => selected.has(m.id));
  const bulkSelectedMovements = movements.filter(m => selected.has(m.id));

  return (
    <section className="space-y-4 pb-6">
      <h3 className="py-2 text-base font-bold text-gray-900 uppercase tracking-wider">Seguimiento de gastos</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* <SummaryCard label="Gasto Total" value={formatCurrency(data.total)} variant="negative" /> */}
        <SummaryCard label="Gasto Medio Mensual" value={<>{formatCurrency(data.averageMonthly)}/mes</>} variant="info" subtitle={`${data.monthCount} meses de histórico`} />
        <SummaryCard label="Media último año" value={<>{formatCurrency(last12Avg)}/mes</>} variant="neutral" subtitle="Últimos 12 meses" />
        <SummaryCard label="Mes Actual" value={formatCurrency(data.currentMonth)} variant="neutral" />
        <SummaryCard label="Mes Anterior" value={formatCurrency(data.previousMonth)} variant="neutral" />
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-3 mb-2 mt-8">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Gastos por mes
          </h4>
          <select
            value={chartCategory}
            onChange={e => setChartCategory(e.target.value)}
            className="ml-auto px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          >
            <option value="all">Todas las categorías</option>
            {data.byCategory.map(c => (
              <option key={c.category} value={c.category}>{c.category}</option>
            ))}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyExpenseChartData(data, chartCategory)} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} width={70} tickFormatter={v => `${v} €`} />
            {monthTooltipRecharts()}
            <Bar
              dataKey="total"
              fill={chartCategory === 'all' ? '#dc2626' : '#f59e0b'}
              radius={[3, 3, 0, 0]}
              name={chartCategory === 'all' ? 'Gastos' : chartCategory}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <CategoryBreakdown categories={data.byCategory} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LastYearBreakdown avgByCategory={last12ByCategory} />
        <LastMonthBreakdown categories={data.byCategory} />
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 my-4 mt-8">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Detalle de gastos
          </h4>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={expSearch}
              onChange={e => setExpSearch(e.target.value)}
              placeholder="Buscar concepto…"
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-44 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <select
              value={expCategory}
              onChange={e => setExpCategory(e.target.value)}
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              <option value="all">Todas las categorías</option>
              {EXPENSE_CATEGORY_LIST.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {bulkSelectedMovements.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 py-2 px-3 rounded-lg bg-gray-900 text-white">
            <span className="text-sm font-semibold">
              {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-300">Mover a:</span>
              <select
                value=""
                onChange={e => {
                  if (e.target.value) {
                    applyBulk(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="px-2.5 py-1.5 border border-gray-600 rounded-lg text-sm bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <option value="">Elegir categoría…</option>
                {EXPENSE_CATEGORY_LIST.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={clearSelection}
              className="ml-auto px-3 py-1.5 rounded-lg border border-gray-600 text-sm font-semibold text-gray-200 hover:bg-gray-700 transition-colors cursor-pointer"
            >
              Limpiar
            </button>
          </div>
        )}
        <ScrollableTable
          columns={[
            {
              title: (
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los visibles"
                  checked={shownAllSelected}
                  onChange={toggleAll}
                  className="w-4 h-4 accent-gray-900 cursor-pointer"
                />
              ),
              align: 'left',
            },
            {
              title: (
                <SortableHeader
                  label="Fecha"
                  active={expSortKey === 'date'}
                  dir={expSortDir}
                  onClick={() => toggleSort('date')}
                />
              ),
              align: 'left',
            },
            { title: 'Concepto', align: 'left' },
            { title: 'Categoría', align: 'left' },
            {
              title: (
                <SortableHeader
                  label="Importe"
                  active={expSortKey === 'amount'}
                  dir={expSortDir}
                  onClick={() => toggleSort('amount')}
                />
              ),
            },
          ]}
          rows={expShown.map(m => [
            {
              content: (
                <input
                  type="checkbox"
                  aria-label={`Seleccionar ${m.concept}`}
                  checked={selected.has(m.id)}
                  onChange={() => toggleOne(m.id)}
                  className="w-4 h-4 accent-gray-900 cursor-pointer"
                />
              ),
            },
            new Date(`${m.date}T00:00:00`).toLocaleDateString('es-ES'),
            {
              content: (
                <span className="block max-w-[420px] whitespace-normal break-words">{m.concept}</span>
              ),
            },
            {
              content: (
                <select
                  value={m.category ?? 'Otros'}
                  onChange={e => onChangeCategory(m.id, e.target.value)}
                  className="max-w-[170px] w-full px-2 py-1 border border-gray-200 rounded-md text-xs bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                >
                  {EXPENSE_CATEGORY_LIST.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              ),
            },
            {
              content: m.type === 'refund' ? (
                <span className="text-teal-600 font-semibold">+{formatCurrency(Math.abs(m.amount))}</span>
              ) : (
                <span className="text-red-600 font-semibold">−{formatCurrency(Math.abs(m.amount))}</span>
              ),
            },
          ])}
        />
        <Pagination page={expPage} totalPages={expTotalPages} onPageChange={setExpPage} />
      </div>
    </section>
  );
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Ordenar por ${label} (${active ? (dir === 'asc' ? 'ascendente' : 'descendente') : 'descendente'})`}
      className={`inline-flex items-center gap-1 uppercase tracking-wider font-bold cursor-pointer group ${
        active ? 'text-gray-900' : 'text-gray-900 hover:text-gray-600'
      }`}
    >
      {label}
      <span className="flex flex-col leading-none">
        <span className={active && dir === 'asc' ? 'text-gray-900' : 'text-gray-300 group-hover:text-gray-400'}>▲</span>
        <span className={active && dir === 'desc' ? 'text-gray-900' : 'text-gray-300 group-hover:text-gray-400'}>▼</span>
      </span>
    </button>
  );
}

function CategoryBreakdown({ categories }: { categories: CategoryTotal[] }) {
  if (categories.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-8">Por categoría</h4>
      <ul className="space-y-2">
        {categories.map(c => (
          <li key={c.category} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-gray-800">{c.category}</span>
              <span className="text-gray-600 text-right flex flex-col justify-end sm:flex-row">
                <span className="text-gray-400">
                  ~ {formatCurrency(c.averageMonthly)}/mes desde {new Date(`${c.firstDate}T00:00:00`).toLocaleDateString('es-ES')} 
                </span>
                <span className="ml-2">{formatCurrency(c.total)}</span>
                <span className="text-gray-400 ml-2">{c.pct.toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-red-400/80"
                style={{ width: `${Math.max(1, Math.min(100, c.pct))}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LastMonthBreakdown({ categories }: { categories: CategoryTotal[] }) {
  const spent = categories.filter(c => c.lastMonth > 0);
  const total = spent.reduce((sum, c) => sum + c.lastMonth, 0);
  if (spent.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-8">
        Este mes por categoría
      </h4>
      <ul className="space-y-2">
        {spent.map(c => (
          <li key={c.category} className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-800">{c.category}</span>
            <span className="text-gray-600">
              <span className="text-red-600 font-semibold">{formatCurrency(c.lastMonth)}</span>
              {total > 0 && <span className="text-gray-400 ml-2">{(c.lastMonth / total) * 100 >= 0.05 ? `${((c.lastMonth / total) * 100).toFixed(1)}%` : '<0.1%'}</span>}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between text-sm border-t border-gray-200 pt-2">
          <span className="font-semibold text-gray-800">Total este mes</span>
          <span className="text-red-600 font-semibold">{formatCurrency(total)}</span>
        </li>
      </ul>
    </div>
  );
}

function LastYearBreakdown({ avgByCategory }: { avgByCategory: Record<string, number> }) {
  const sorted = Object.entries(avgByCategory)
    .filter(([, avg]) => avg > 0)
    .sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  const total = sorted.reduce((sum, [, avg]) => sum + avg, 0);
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-8">
        Último año por categoría
      </h4>
      <ul className="space-y-2">
        {sorted.map(([category, avg]) => (
          <li key={category} className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-800">{category}</span>
            <span className="text-gray-600">
              <span className="text-red-600 font-semibold">{formatCurrency(avg)}/mes</span>
              {total > 0 && <span className="text-gray-400 ml-2">{(avg / total) * 100 >= 0.05 ? `${((avg / total) * 100).toFixed(1)}%` : '<0.1%'}</span>}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between text-sm border-t border-gray-200 pt-2">
          <span className="font-semibold text-gray-800">Total último año</span>
          <span className="text-red-600 font-semibold">{formatCurrency(total)}/mes</span>
        </li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// Tamaño de página para el listado paginado de ingresos.
const INCOME_PAGE_SIZE = 10;

const ALL_MOVEMENT_TYPES = Object.keys(MOVEMENT_TYPE_LABELS) as MovementType[];

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-2">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="px-3 py-1 text-xs font-semibold rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        ← Anterior
      </button>
      <span className="text-xs text-gray-500">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="px-3 py-1 text-xs font-semibold rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        Siguiente →
      </button>
    </div>
  );
}

function MovementsSection({
  movements,
  total,
  types,
  filter,
  search,
  onFilterChange,
  onSearchChange,
  onChangeType,
  onBulkChangeType,
}: {
  movements: Movement[];
  total: number;
  types: MovementType[];
  filter: 'all' | MovementType;
  search: string;
  onFilterChange: (v: 'all' | MovementType) => void;
  onSearchChange: (v: string) => void;
  onChangeType: (id: string, type: MovementType) => void;
  onBulkChangeType: (ids: string[], type: MovementType) => void;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [movSortKey, setMovSortKey] = useState<'date' | 'amount'>('date');
  const [movSortDir, setMovSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedMovements = useMemo(() => {
    const dir = movSortDir === 'asc' ? 1 : -1;
    const list = [...movements];
    if (movSortKey === 'amount') {
      // Se ordena por el importe firmado: los valores negativos (gastos,
      // retiradas, compras) y las devoluciones quedan por debajo de 0.
      list.sort((a, b) => (a.amount - b.amount) * dir);
    } else {
      list.sort((a, b) => a.date.localeCompare(b.date) * dir);
    }
    return list;
  }, [movements, movSortKey, movSortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedMovements.length / PAGE_SIZE));
  const shown = sortedMovements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [movements, movSortKey, movSortDir]);

  const toggleMovSort = (key: 'date' | 'amount') => {
    if (movSortKey === key) {
      setMovSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setMovSortKey(key);
      setMovSortDir('desc');
    }
  };

  useEffect(() => {
    const visible = new Set(movements.map(m => m.id));
    setSelected(prev => new Set([...prev].filter(id => visible.has(id))));
  }, [movements]);

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => {
      const currentIds = shown.map(m => m.id);
      const allSelected = currentIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) for (const id of currentIds) next.delete(id);
      else for (const id of currentIds) next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const applyBulk = (type: MovementType) => {
    if (selected.size === 0) return;
    onBulkChangeType([...selected], type);
    clearSelection();
  };

  const shownAllSelected = shown.length > 0 && shown.every(m => selected.has(m.id));

  return (
    <section className="space-y-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="py-2 text-base font-bold text-gray-900 uppercase tracking-wider">
          Todos los movimientos ({total})
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={e => { onSearchChange(e.target.value); setPage(1); }}
            placeholder="Buscar concepto…"
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-44 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
          <select
            value={filter}
            onChange={e => { onFilterChange(e.target.value as 'all' | MovementType); setPage(1); }}
            className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          >
            <option value="all">Todos los tipos</option>
            {types.map(t => (
              <option key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 py-2 px-3 rounded-lg bg-gray-900 text-white">
          <span className="text-sm font-semibold">
            {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-300">Cambiar tipo a:</span>
            <select
              value=""
              onChange={e => {
                if (e.target.value) {
                  applyBulk(e.target.value as MovementType);
                  e.target.value = '';
                }
              }}
              className="px-2.5 py-1.5 border border-gray-600 rounded-lg text-sm bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
            >
              <option value="">Elegir tipo…</option>
              {ALL_MOVEMENT_TYPES.map(t => (
                <option key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto px-3 py-1.5 rounded-lg border border-gray-600 text-sm font-semibold text-gray-200 hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Limpiar
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">Ningún movimiento coincide con el filtro.</p>
      ) : (
        <ScrollableTable
          columns={[
            {
              title: (
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los visibles"
                  checked={shownAllSelected}
                  onChange={toggleAll}
                  className="w-4 h-4 accent-gray-900 cursor-pointer"
                />
              ),
              align: 'left',
            },
            {
              title: (
                <SortableHeader
                  label="Fecha"
                  active={movSortKey === 'date'}
                  dir={movSortDir}
                  onClick={() => toggleMovSort('date')}
                />
              ),
              align: 'left',
            },
            { title: 'Banco', align: 'left', muted: true },
            { title: 'Tipo', align: 'left' },
            { title: 'Concepto', align: 'left' },
            {
              title: (
                <SortableHeader
                  label="Importe"
                  active={movSortKey === 'amount'}
                  dir={movSortDir}
                  onClick={() => toggleMovSort('amount')}
                />
              ),
            },
          ]}
          rows={shown.map(m => [
            {
              content: (
                <input
                  type="checkbox"
                  aria-label={`Seleccionar ${m.concept}`}
                  checked={selected.has(m.id)}
                  onChange={() => toggleOne(m.id)}
                  className="w-4 h-4 accent-gray-900 cursor-pointer"
                />
              ),
            },
            new Date(`${m.date}T00:00:00`).toLocaleDateString('es-ES'),
            { content: <span className="text-gray-500">{BANK_LABELS[m.bank]}</span>, className: 'text-sm' },
            {
              content: (
                <select
                  value={m.type}
                  onChange={e => onChangeType(m.id, e.target.value as MovementType)}
                  className="max-w-[140px] w-full px-2 py-1 border border-gray-200 rounded-md text-xs bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                >
                  {ALL_MOVEMENT_TYPES.map(t => (
                    <option key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              ),
            },
            {
              content: (
                <span className="block truncate max-w-[340px]">
                  {m.concept}
                  {(m.shares !== undefined || m.price !== undefined) && (
                    <span className="ml-2 text-xs text-gray-400">
                      {m.shares !== undefined ? `${formatQuantity(m.shares)} part.` : ''}
                      {m.price !== undefined ? ` @ ${m.price}` : ''}
                    </span>
                  )}
                </span>
              ),
            },
            {
              content: (
                <span className={
                  m.type === 'tax'
                    ? 'text-red-700'
                    : m.amount >= 0
                      ? 'text-emerald-700'
                      : 'text-gray-800'
                }>
                  {signedAmount(
                    m.type === 'interest'
                      ? interestNetAmount(m)
                      : m.type === 'tax'
                        ? -Math.abs(m.amount)
                        : m.amount
                  )}
                </span>
              ),
            },
          ])}
        />
      )}
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers de gráficos
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function monthlyChartData(points: Array<{ month: string; total: number }>) {
  return points.map(p => ({ ...p, label: fmtMonthLabel(p.month) }));
}

function monthlyExpenseSlice(points: Array<{ month: string; total: number }>) {
  return points.slice(-24);
}

/** Datos para la gráfica «Gastos por mes», filtrando por categoría cuando se elige una. */
function monthlyExpenseChartData(
  data: ReturnType<typeof computeExpenses>,
  category: string,
) {
  const points = category === 'all' ? data.monthly : data.monthlyByCategory[category] ?? [];
  return monthlyChartData(monthlyExpenseSlice(points));
}

function monthTooltipRecharts() {
  return (
    <RechartsTooltip
      cursor={{ fill: 'rgba(0,0,0,0.04)' }}
      content={
        <ChartTooltip
          renderContent={payload => (
            <>
              <p className="font-semibold text-gray-900">
                {String(payload[0]?.payload?.label ?? '')}
              </p>
              <p className="text-gray-700">{formatCurrency(Number(payload[0]?.value ?? 0))}</p>
            </>
          )}
        />
      }
    />
  );
}
