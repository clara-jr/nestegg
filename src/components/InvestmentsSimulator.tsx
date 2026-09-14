import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatAxisCurrency, formatCurrency, formatSigned } from '../lib/calculations';
import {
  BANKS,
  MOVEMENT_TYPE_LABELS,
  hashId,
  mergeSplitTrades,
  movementSignature,
  normalizeStoredMovements,
  parseBankMatrix,
  paypalDuplicateIds,
  reclassifyPaypalDuplicates,
  readFileAsMatrix,
  type BankId,
  type FileMeta,
  type Movement,
  type MovementType,
} from '../lib/bankImports';
import {
  EXPENSE_CATEGORY_LIST,
  averageInRange,
  buildConceptCategoryMap,
  cleanConcept,
  completedMonths,
  computeAccountEvolution,
  computeBankBreakdown,
  computeCashBalance,
  computeDailySeries,
  computeExpenses,
  computeIncome,
  computeInterest,
  computePortfolio,
  currentMonthKey,
  DAY_FILTER,
  averageMonthlyInRange,
  fillMonthly,
  formatDay,
  formatMonth,
  guessExpenseCategory,
  interestNetAmount,
  monthsBetween,
  rangeFromDay,
  rangeMonth,
  rangeToDay,
  resolveExpenseCategory,
  shiftMonth,
  sumDailyRange,
  type AccountEvolutionPoint,
  type BankBreakdownEntry,
  type CategoryTotal,
  type Holding,
  type MonthPoint,
  type PlazoFijoConfig,
} from '../lib/investments';
import { fetchPrices, type PriceRequest } from '../lib/prices';
import { dispatchDataChanged, useProfileLocalStorage, useProfiles } from '../lib/profiles';
import { useFontsReady } from '../lib/fonts';
import ProfileSelector from './ProfileSelector';
import JointSimulator from './JointSimulator';
import { SimulatorLoading } from './common/layout/SimulatorLoading';
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
  FormContainer,
  FormSection,
  IncomeExpenseTooltip,
  LastMonthBreakdown,
  LastYearBreakdown,
  Modal,
  NumberInput,
  ResultsContainer,
  ScenarioSection,
  ScrollableTable,
  Select,
  SimulatorLayout,
  SummaryCard,
  Tooltip,
  signedExpenseFormat,
  Icon,
  BankLogo,
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

type SectionTab = 'portfolio' | 'account' | 'income' | 'expenses' | 'movements' | 'joint';

const SECTION_TABS: ReadonlyArray<{ id: SectionTab; label: string; onlyWithTwoProfiles?: boolean }> = [
  { id: 'portfolio', label: 'Cartera' },
  { id: 'account', label: 'Cuenta' },
  { id: 'income', label: 'Ingresos' },
  { id: 'expenses', label: 'Gastos' },
  { id: 'movements', label: 'Movimientos' },
  { id: 'joint', label: 'Convivencia', onlyWithTwoProfiles: true },
];

const BANK_LABELS: Record<BankId, string> = Object.fromEntries(
  BANKS.map(b => [b.id, b.label])
) as Record<BankId, string>;

const ORDERED_BANKS = [...BANKS].sort((a, b) => a.label.localeCompare(b.label, 'es'));

function fmtMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
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
  const { profiles } = useProfiles();
  const [store, setStore, storeReady] = useProfileLocalStorage<InvestmentsStore>('nestegg-investments-v1', {
    files: [],
    movements: [],
  });
  const [priceMap, setPriceMap] = useProfileLocalStorage<PriceMap>('nestegg-prices-v1', {});
  // Parámetros declarados por el usuario para cada depósito a plazo (TIR + duración).
  const [plazoConfigs, setPlazoConfigs] = useProfileLocalStorage<Record<string, PlazoFijoConfig>>('nestegg-plazos-v1', {});
  const fontsReady = useFontsReady();
  const [bank, setBank] = useState<BankId>(ORDERED_BANKS[0].id);
  const [tab, setTab] = useState<SectionTab>('portfolio');
  // «Convivencia» solo existe cuando hay más de un perfil; si se elimina el
  // segundo, se vuelve a la sección Cartera.
  useEffect(() => {
    if (tab === 'joint' && profiles.length <= 1) setTab('portfolio');
  }, [tab, profiles.length]);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [priceStatus, setPriceStatus] = useState<string | null>(null);
  const [movementFilter, setMovementFilter] = useState<'all' | MovementType>('all');
  const [bankFilter, setBankFilter] = useState<'all' | BankId>('all');
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
  const [pendingClearAll, setPendingClearAll] = useState(false);
  const [showFileHistory, setShowFileHistory] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [editingFile, setEditingFile] = useState<{ id: string; name: string } | null>(null);

  const priceOf = (key: string, ticker?: string, isin?: string): number | undefined => {
    if (!key) return undefined;
    if (priceMap[key]) return priceMap[key].value;
    if (ticker && priceMap[ticker]) return priceMap[ticker].value;
    if (isin && priceMap[isin]) return priceMap[isin].value;
    return undefined;
  };

  // Movimientos efectivos: se reclasifican de forma derivada como «Traspaso»
  // los cargos de otros bancos que duplican un movimiento de PayPal. La misma
  // derivación se aplica en la vista conjunta para que ambas coincidan.
  const visibleMovements = useMemo(() => reclassifyPaypalDuplicates(store.movements), [store.movements]);

  const portfolio = useMemo(
    () => computePortfolio(visibleMovements, priceOf, plazoConfigs),
    [visibleMovements, priceMap, plazoConfigs]
  );
  const interest = useMemo(() => {
    const interestMovements = visibleMovements.filter(m => m.type === 'interest');
    const taxOnInterest = visibleMovements.filter(
      m => m.type === 'tax' && /INTERES/i.test(m.concept)
    );
    return computeInterest(interestMovements, taxOnInterest);
  }, [visibleMovements]);
  const expenses = useMemo(
    () => computeExpenses(visibleMovements.filter(m => m.type === 'expense' || m.type === 'refund')),
    [visibleMovements]
  );
  const income = useMemo(
    () => computeIncome(visibleMovements.filter(m => m.type === 'income')),
    [visibleMovements]
  );
  const savingsAvg = income.averageMonthly - expenses.averageMonthly;

  const hasData = store.movements.length > 0;

  // Notifica a la vista conjunta cuando cambian los datos de este perfil.
  useEffect(() => {
    if (!storageHydratedRef.current) return;
    dispatchDataChanged();
  }, [store]);
  const storageHydratedRef = useRef(false);
  useEffect(() => { storageHydratedRef.current = true; }, []);

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
    () => computeCashBalance(visibleMovements),
    [visibleMovements]
  );
  const account = useMemo(
    () => computeAccountEvolution(visibleMovements),
    [visibleMovements]
  );
  const bankBreakdown = useMemo(
    () => computeBankBreakdown(visibleMovements),
    [visibleMovements]
  );

  const totalCapital = portfolio.summary.currentValue + cashBalance;
  const totalBenefit = portfolio.summary.totalBenefit + interest.total;
  const benefitPct = meaningfulPct(totalBenefit, totalCapital);

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

      // Cuenta los cargos de otros bancos (CaixaBank/Santander…) que pasan a
      // reclasificarse como Traspaso por duplicar un movimiento de PayPal tras
      // esta importación.
      const hiddenBefore = new Set(paypalDuplicateIds(store.movements));
      const hiddenAfter = paypalDuplicateIds([...store.movements, ...toAdd]);
      let newlyHidden = 0;
      for (const id of hiddenAfter) if (!hiddenBefore.has(id)) newlyHidden++;

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
        if (newlyHidden > 0) {
          parts.push(`${newlyHidden} cargo${newlyHidden === 1 ? '' : 's'} de banco reclasificado${newlyHidden === 1 ? '' : 's'} a Traspaso por duplicar PayPal`);
        }
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

  const renameFile = (fileId: string, name: string) => {
    setStore(prev => ({
      ...prev,
      files: prev.files.map(f => (f.id === fileId ? { ...f, name } : f)),
    }));
  };

  const commitRename = () => {
    if (!editingFile) return;
    const name = editingFile.name.trim();
    if (name) renameFile(editingFile.id, name);
    setEditingFile(null);
  };

  const clearAll = () => {
    setStore({ files: [], movements: [] });
    setPriceStatus(null);
    setFeedback(null);
    setPendingClearAll(false);
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

  const applyDeleteMovements = (movementIds: string[]) => {
    if (movementIds.length === 0) return;
    setStore(prev => ({
      ...prev,
      movements: prev.movements.filter(m => !movementIds.includes(m.id)),
    }));
  };

  const deleteMovement = (movementId: string) => applyDeleteMovements([movementId]);

  const requestDelete = (movementIds: string[]) => {
    if (movementIds.length === 0) return;
    setPendingDeleteIds(movementIds);
  };

  const confirmDelete = () => {
    if (!pendingDeleteIds) return;
    applyDeleteMovements(pendingDeleteIds);
    setPendingDeleteIds(null);
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
      visibleMovements
        .filter(m => m.type === 'buy' && !m.fundOperation)
        .map(m => `${m.date}|${Math.abs(m.amount)}`)
    );
    return visibleMovements
      .filter(m => {
        if (m.type === 'buy' && m.fundOperation) {
          if (accountKeys.has(`${m.date}|${Math.abs(m.amount)}`)) return false;
        }
        return true;
      })
      .filter(m => (movementFilter === 'all' ? true : m.type === movementFilter))
      .filter(m => (bankFilter === 'all' ? true : m.bank === bankFilter))
      .filter(m =>
        q.length === 0 ||
        m.concept.toLowerCase().includes(q) ||
        (m.ticker ?? '').toLowerCase().includes(q) ||
        (m.isin ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [visibleMovements, movementFilter, bankFilter, search]);

  const presentTypes = useMemo(() => {
    const types = new Set<MovementType>();
    for (const m of visibleMovements) types.add(m.type);
    return [...types];
  }, [visibleMovements]);

  // Orden por defecto por % Anual: solo se recalcula cuando cambia la
  // composición de la cartera (entra o sale un producto), nunca al editar los
  // precios o valores actuales, para que la tabla no se reordene bajo el cursor.
  // La clave usa los keys ordenados alfabéticamente: portfolio.holdings llega
  // ordenado por valor, así que su orden cambiaría al editar un precio.
  // IMPORTANTE: solo se memoiza la disposición (orden de keys); los objetos
  // holding se toman en cada render de portfolio.holdings, que sí se recalcula
  // al cambiar los precios, para que Latente/Valor/Total se actualicen.
  const holdingsCompositionKey = portfolio.holdings.map(h => h.key).sort().join('|');
  const orderedHoldings = useMemo(() => {
    const sortValue = (h: Holding) => annualizedGainRatio(h) ?? Number.NEGATIVE_INFINITY;
    return [...portfolio.holdings]
      .sort(
        (a, b) =>
          sortValue(b) - sortValue(a) || // % Anual descendente (no anualizables al final)
          b.value - a.value ||
          a.name.localeCompare(b.name)
      )
      .map(h => h.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsCompositionKey]);

  const holdingsWithSource = useMemo(() => {
    const byKey = new Map(portfolio.holdings.map(h => [h.key, h]));
    return orderedHoldings.flatMap(key => {
      const h = byKey.get(key);
      if (!h) return [];
      const entry: PriceEntry | null =
        priceMap[h.key] ??
        (h.ticker ? priceMap[h.ticker] : undefined) ??
        (h.isin ? priceMap[h.isin] : undefined) ??
        null;
      return [{ holding: h, entry }];
    });
  }, [portfolio.holdings, orderedHoldings, priceMap]);

  if (!fontsReady || !storeReady) {
    return (
      <SimulatorLayout>
        <SimulatorLoading />
      </SimulatorLayout>
    );
  }

  return (
    <SimulatorLayout>
      <ProfileSelector />
      <FormContainer>
        <FormSection title="Importar extractos bancarios" cols="single">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Banco de origen</span>
              <Select
                value={bank}
                size="md"
                fullWidth
                ariaLabel="Banco de origen"
                onChange={handleBankChange}
                options={ORDERED_BANKS.map(b => ({ value: b.id, label: b.label, icon: <BankLogo bank={b.id} size={18} /> }))}
              />
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
                className="w-full text-sm text-gray-600 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border file:border-gray-200 file:bg-zinc-100 file:text-gray-900 file:text-sm file:font-semibold file:cursor-pointer hover:file:bg-zinc-200 cursor-pointer"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing
                ? 'Importando…'
                : (
                    <>
                      <Icon name="upload" className="h-4 w-4" />
                      Importar movimientos
                    </>
                  )}
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
                <button
                  type="button"
                  onClick={() => setShowFileHistory(v => !v)}
                  aria-expanded={showFileHistory}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:text-gray-900 transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`transition-transform duration-150 ${showFileHistory ? 'rotate-90' : ''}`}
                  >
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                  Histórico de ficheros ({store.files.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPendingClearAll(true)}
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
              {showFileHistory && (
                <ul
                  className="grid gap-2 w-full grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {store.files.map(f => (
                    <li
                      key={f.id}
                      className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 min-w-0 w-full rounded-full bg-zinc-100 border border-gray-200 text-xs text-gray-700"
                    >
                      <span className="inline-flex items-center gap-1.5 shrink-0 font-semibold">
                        <BankLogo bank={f.bank} size={12} />
                        {BANK_LABELS[f.bank]}
                      </span>
                      {editingFile?.id === f.id ? (
                        <input
                          autoFocus
                          value={editingFile.name}
                          onChange={e => setEditingFile({ id: f.id, name: e.target.value })}
                          onBlur={commitRename}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setEditingFile(null);
                          }}
                          className="flex-1 min-w-0 px-1.5 py-0.5 rounded-md border border-gray-300 bg-[#fdfdfe] text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                        />
                      ) : (
                        <>
                          <span className="truncate flex-1 min-w-0">{f.name}</span>
                          <button
                            type="button"
                            onClick={() => setEditingFile({ id: f.id, name: f.name })}
                            aria-label="Renombrar fichero"
                            title="Renombrar fichero"
                            className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                            </svg>
                          </button>
                        </>
                      )}
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
              )}
            </div>
          )}
        </FormSection>
      </FormContainer>

      <ResultsContainer>
        {!hasData ? (
          <div className="py-14 flex flex-col items-center justify-center text-center gap-3">
            <Icon name="chart" className="h-14 w-14 text-gray-400" />
            <p className="text-base font-bold text-gray-900">Aún no hay datos</p>
            <p className="text-sm text-gray-500 max-w-md leading-relaxed">
              Sube los extractos CSV/XLS de tus bancos para ver el beneficio de tu cartera,
              los intereses de cuentas remuneradas y un seguimiento mensual de tus gastos.
              Todo se guarda únicamente en tu navegador.
            </p>
          </div>
        ) : (
          <>
            <ScenarioSection title="Resumen de Finanzas" gridCols="grid grid-cols-1 min-[500px]:grid-cols-2 lg:grid-cols-3 gap-3">
              <SummaryCard
                label="Capital Total"
                value={formatCurrency(totalCapital)}
                variant="info"
                subtitle={capitalSplitSubtitle(portfolio.summary.currentValue, cashBalance)}
              />
              <SummaryCard
                label="Beneficio Total"
                value={`${formatSigned(totalBenefit)}${benefitPct !== null ? ` (${formatSignedPct(benefitPct)})` : ''}`}
                variant={
                  totalBenefit > 0.005 ? 'positive' : totalBenefit < -0.005 ? 'negative' : 'neutral'
                }
                subtitle={`Cartera ${formatSigned(portfolio.summary.totalBenefit)} · Cuenta ${formatSigned(interest.total)}`}
              />
              <SummaryCard
                label="Capacidad de Ahorro"
                value={`${formatSigned(savingsAvg)}/mes`}
                variant={savingsAvg >= 0 ? 'positive' : 'negative'}
                subtitle={`Ingresos medios: ${formatSigned(income.averageMonthly)} · Gastos medios: ${formatSigned(-expenses.averageMonthly)}`}
              />
            </ScenarioSection>

            <div className="-mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200 pt-5 space-y-5">
              <div className="flex flex-wrap gap-2">
                {SECTION_TABS.filter(t => !t.onlyWithTwoProfiles || profiles.length > 1).map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`px-4 py-2 text-sm font-semibold rounded-full border transition-colors cursor-pointer ${
                      tab === t.id
                        ? 'bg-zinc-100 text-gray-900 border-gray-200'
                        : 'bg-[#fdfdfe] text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900'
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
                  expCurrent={expenses.currentMonth}
                  expPrev={expenses.previousMonth}
                  expMonthly={expenses.monthly}
                  movements={visibleMovements.filter(m => m.type === 'income')}
                  expenseMovements={visibleMovements.filter(m => m.type === 'expense' || m.type === 'refund')}
                />
              )}

              {tab === 'expenses' && (
                <ExpensesSection
                  data={expenses}
                  income={income}
                  movements={visibleMovements.filter(m => m.type === 'expense' || m.type === 'refund')}
                  incomeMovements={visibleMovements.filter(m => m.type === 'income')}
                  onChangeCategory={updateCategory}
                  onBulkChangeCategory={bulkUpdateCategory}
                />
              )}

              {tab === 'movements' && (
                <MovementsSection
                  movements={filteredMovements}
                  types={presentTypes}
                  filter={movementFilter}
                  bankFilter={bankFilter}
                  search={search}
                  onFilterChange={setMovementFilter}
                  onBankFilterChange={setBankFilter}
                  onSearchChange={setSearch}
                  onChangeType={updateType}
                  onBulkChangeType={bulkUpdateType}
                  onDelete={deleteMovement}
                  onRequestBulkDelete={requestDelete}
                />
              )}

              {tab === 'joint' && profiles.length > 1 && <JointSimulator />}
            </div>
          </>
        )}

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
            className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            Solo este
          </button>
          <button
            type="button"
            onClick={confirmMoveAll}
            className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
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
            className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            Solo este
          </button>
          <button
            type="button"
            onClick={confirmTypeAll}
            className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
          >
            Cambiar todos ({pendingTypeChange?.ids.length})
          </button>
        </div>
      </Modal>

      <Modal
        open={pendingClearAll}
        onClose={() => setPendingClearAll(false)}
        title="Vaciar todos los datos"
      >
        <p className="text-sm text-gray-700 leading-relaxed">
          ¿Vaciar todos los movimientos e histórico de ficheros importados?
        </p>
        <p className="text-sm text-gray-500 leading-relaxed mt-2">
          Esta acción no se puede deshacer.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={() => setPendingClearAll(false)}
            className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors cursor-pointer"
          >
            Vaciar todo
          </button>
        </div>
      </Modal>
    <Modal
        open={pendingDeleteIds !== null}
        onClose={() => setPendingDeleteIds(null)}
        title="Eliminar movimientos"
      >
        <p className="text-sm text-gray-700 leading-relaxed">
          ¿Eliminar{' '}
          <span className="font-semibold text-gray-900">{pendingDeleteIds?.length ?? 0}</span>{' '}
          movimiento{pendingDeleteIds && pendingDeleteIds.length !== 1 ? 's' : ''}?
        </p>
        <p className="text-sm text-gray-500 leading-relaxed mt-2">
          Esta acción no se puede deshacer.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={() => setPendingDeleteIds(null)}
            className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors cursor-pointer"
          >
            Eliminar
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
  type PortfolioSort = 'annual' | 'tipo' | 'latente' | 'recibido' | 'total';
  const [portfolioSort, setPortfolioSort] = useState<PortfolioSort>('annual');
  const [portfolioDir, setPortfolioDir] = useState<'asc' | 'desc'>('desc');
  const valuePct = meaningfulPct(summary.currentValue - summary.investedCost, summary.investedCost);

  // Clave de composición estable (keys alfabéticos): solo cambia cuando entra
  // o sale un producto, nunca al editar precios.
  const holdingsCompositionKey = rows.map(r => r.holding.key).sort().join('|');

  // Orden por % Anual: se memoiza solo la disposición (orden de keys) por
  // composición y dirección, para que editar un precio no reordene la fila
  // bajo el cursor pero los valores mostrados sigan siendo los actuales.
  const annualOrder = useMemo(() => {
    const mult = portfolioDir === 'asc' ? -1 : 1;
    return [...rows]
      .sort((a, b) => {
        const sa = annualizedGainRatio(a.holding) ?? Number.NEGATIVE_INFINITY;
        const sb = annualizedGainRatio(b.holding) ?? Number.NEGATIVE_INFINITY;
        return (sb - sa) * mult || (b.holding.value - a.holding.value) * mult || a.holding.name.localeCompare(b.holding.name);
      })
      .map(r => r.holding.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsCompositionKey, portfolioDir]);

  // El resto de columnas ordena en vivo por el valor actual de cada fila.
  const sortedRows = useMemo(() => {
    if (portfolioSort === 'annual') {
      const byKey = new Map(rows.map(r => [r.holding.key, r]));
      return annualOrder
        .map(k => byKey.get(k))
        .filter((r): r is { holding: Holding; entry: PriceEntry | null } => r !== undefined);
    }
    const mult = portfolioDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const ha = a.holding;
      const hb = b.holding;
      let cmp: number;
      if (portfolioSort === 'tipo') {
        cmp = investmentTypeLabel(ha.assetClass).localeCompare(investmentTypeLabel(hb.assetClass));
      } else if (portfolioSort === 'latente') {
        cmp = ha.unrealizedPnl - hb.unrealizedPnl;
      } else if (portfolioSort === 'recibido') {
        cmp = ha.realizedPnl - hb.realizedPnl;
      } else {
        cmp = ha.totalPnl - hb.totalPnl;
      }
      return cmp * mult || ha.name.localeCompare(hb.name);
    });
  }, [rows, portfolioSort, portfolioDir, annualOrder]);

  const handlePortfolioSort = (key: PortfolioSort, defaultDir: 'asc' | 'desc') => {
    if (portfolioSort === key) {
      setPortfolioDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setPortfolioSort(key);
      setPortfolioDir(defaultDir);
    }
  };

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
        {/*portfolioSort !== 'annual' && (
          <button
            type="button"
            onClick={() => {
              setPortfolioSort('annual');
              setPortfolioDir('desc');
            }}
            className="px-3 py-1.5 rounded-xl border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            ↺ Ordenar por % Anual
          </button>
        )*/}
        {/*<div className="flex items-center gap-3">
          {status && <p className="text-xs text-gray-500 max-w-[320px] text-right">{status}</p>}
          <button
            type="button"
            onClick={onUpdatePrices}
            disabled={updating}
            className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-zinc-100 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {updating ? 'Actualizando…' : '🔄 Actualizar precios'}
          </button>
        </div>*/}
      </div>

      <div className="grid grid-cols-1 min-[500px]:grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <SummaryCard label="Invertido" value={formatCurrency(summary.investedCost)} variant="info" />
        <SummaryCard label="Valor Actual" value={formatCurrency(summary.currentValue)} variant="info" subtitle={valuePct !== null ? formatSignedPct(valuePct) : undefined} />
        <SummaryCard label="Latente" value={formatSigned(summary.unrealized)} variant={summary.unrealized >= 0 ? 'positive' : 'negative'} subtitle="Pendiente de vender" />
        <SummaryCard label="Recibido" value={formatSigned(summary.realized)} variant={summary.realized >= 0 ? 'positive' : 'negative'} subtitle="Ventas" />
        <SummaryCard label="Dividendos" value={formatSigned(summary.dividends)} subtitle={undefined} />
      </div>

      <ScrollableTable
        columns={[
          { title: 'Producto', align: 'left' },
          {
            title: (
              <SortableHeader
                label="Tipo"
                active={portfolioSort === 'tipo'}
                dir={portfolioDir}
                onClick={() => handlePortfolioSort('tipo', 'asc')}
              />
            ),
            align: 'left',
            minWidth: 120,
          },
          //{ title: 'Días' },
          { title: 'Partic.', minWidth: 105 },
          { title: 'P. medio', minWidth: 150 },
          { title: 'P. actual', align: 'left', minWidth: 170 },
          { title: 'TIR %', minWidth: 110 },
          { title: 'Duración', minWidth: 130 },
          { title: 'Invertido', minWidth: 135 },
          { title: 'Valor', minWidth: 135 },
          {
            title: (
              <SortableHeader
                label="Latente"
                active={portfolioSort === 'latente'}
                dir={portfolioDir}
                onClick={() => handlePortfolioSort('latente', 'desc')}
              />
            ),
            minWidth: 145,
          },
          {
            title: (
              <SortableHeader
                label="Recibido"
                active={portfolioSort === 'recibido'}
                dir={portfolioDir}
                onClick={() => handlePortfolioSort('recibido', 'desc')}
              />
            ),
            minWidth: 150,
          },
          { title: 'Dividendos', minWidth: 150 },
          {
            title: (
              <SortableHeader
                label="Total"
                active={portfolioSort === 'total'}
                dir={portfolioDir}
                onClick={() => handlePortfolioSort('total', 'desc')}
              />
            ),
            minWidth: 130,
          },
          {
            title: (
              <SortableHeader
                label="% Anual"
                active={portfolioSort === 'annual'}
                dir={portfolioDir}
                onClick={() => handlePortfolioSort('annual', 'desc')}
              />
            ),
            minWidth: 145,
          },
        ]}
        rows={sortedRows.map(({ holding: h, entry }) => {
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
                        <NumberInput
                          value={String(entry?.value ?? '')}
                          placeholder={h.avgPrice.toFixed(2)}
                          onChange={onSetPrice.bind(null, h.key, h.ticker)}
                          className="w-24"
                        />
                      </Tooltip>
                    ),
                  },
            isPF && h.investedCost > 0
              ? {
                  content: (
                    <NumberInput
                      value={plazoCfg?.rate ? String(plazoCfg.rate) : ''}
                      placeholder="% anual"
                      onChange={v => onSetPlazoConfig(h.key, { rate: Number.parseFloat(v.replace(',', '.')) })}
                      step={0.5}
                      className="w-20"
                    />
                  ),
                }
              : '—',
            isPF && h.investedCost > 0
              ? {
                  content: (
                    <NumberInput
                      value={plazoCfg?.months ? String(plazoCfg.months) : ''}
                      placeholder="meses"
                      onChange={v => onSetPlazoConfig(h.key, { months: Number.parseFloat(v.replace(',', '.')) })}
                      className="w-20"
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
                      <span className={pnlColor(h.unrealizedPnl)}>{formatSigned(h.unrealizedPnl)}</span>
                    </Tooltip>
                  ),
                },
            { content: <span className={pnlColor(h.realizedPnl)}>{formatSigned(h.realizedPnl)}</span> },
            { content: <span className="text-gray-600">{isPF ? '—' : formatSigned(h.dividends)}</span> },
            {
              content: (
                <span className={pnlColor(h.totalPnl)}>
                  {formatSigned(h.totalPnl)}
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
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** Variación porcentual de `value` sobre `base`. Devuelve `null` si la base es 0
 *  o el resultado no es un número finito (evita mostrar NaN%/Infinity%). */
function pctChange(value: number, base: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(base) || Math.abs(base) < 1e-9) return null;
  const p = (value / base) * 100;
  return Number.isFinite(p) ? p : null;
}

function formatSignedPct(p: number | null): string {
  return p === null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(2)}%`;
}

/** Igual que `pctChange` pero considera 0% como "sin dato" (devuelve `null`). */
function meaningfulPct(value: number, base: number): number | null {
  const p = pctChange(value, base);
  return p !== null && Math.abs(p) >= 1e-9 ? p : null;
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
  const cashPct = meaningfulPct(account.totalInterest, cashBalance - account.totalInterest);

  return (
    <section className="space-y-4 pb-6">
      <h3 className="py-2 text-base font-bold text-gray-900 uppercase tracking-wider">Evolución de la cuenta</h3>
      <div className="grid grid-cols-1 min-[500px]:grid-cols-2 lg:grid-cols-3 gap-3">
        <SummaryCard
          label="Efectivo en Cuenta"
          value={formatCurrency(cashBalance)}
          variant="info"
          subtitle={cashPct !== null ? formatSignedPct(cashPct) : undefined}
        />
        <SummaryCard
          label="Intereses"
          value={formatSigned(account.totalInterest)}
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
          value={formatSigned(data.currentYear)}
          variant="info"
        />
      </div>

      {bankBreakdown.length > 1 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-8">Saldo por cuenta</h4>
          <ScrollableTable
            columns={[
              { title: 'Banco', align: 'left' },
              { title: 'Invertido' },
              { title: 'Saldo' },
              { title: 'Intereses' },
            ]}
            rows={bankBreakdown.map(b => [
              { content: <span className="inline-flex items-center gap-2 font-semibold text-gray-900"><BankLogo bank={b.bank as BankId} size={18} />{BANK_LABELS[b.bank as BankId] ?? b.bank}</span> },
              { content: <span className={b.balance >= 0 ? 'text-gray-900' : 'text-red-600'}>{formatCurrency(b.balance - b.interest)}</span> },
              { content: <span className={b.balance >= 0 ? 'text-gray-900' : 'text-red-600'}>{formatCurrency(b.balance)}</span> },
              { content: <span className={b.interest > 0 ? 'text-emerald-600 font-semibold' : 'text-gray-500'}>{formatSigned(b.interest)}</span> },
            ])}
          />
        </div>
      )}

      {/*<div>
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Evolución del dinero en la cuenta (ingresos + intereses)
        </h4>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={evolutionChartData(account.evolution)} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid stroke="#ececea" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9b9a95' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#9b9a95' }} width={70} tickFormatter={v => `${v} €`} />
            {accountTooltip()}
            <Line
              type="monotone"
              dataKey="total"
              name="En cuenta"
stroke="#00bc7d"
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
          { title: 'Intereses' },
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
    formatSigned(totals.contributed),
    {
      content: (
        <span className={totals.interest > 0 ? 'text-emerald-600 font-semibold' : ''}>
          {formatSigned(totals.interest)}
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
                <p style={{ color: '#706f6c' }}>Ingresos: {formatSigned(contributed)}</p>
                <p style={{ color: '#00bc7d' }}>Intereses: {formatSigned(interest)}</p>
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

/** Etiqueta del intervalo de los últimos 12 meses calendario ya terminados
 *  (p. ej. «sep 25 – ago 26»), el mismo criterio que usa la media anual. */
function last12WindowLabel(monthly: MonthPoint[]): string | null {
  const completed = completedMonths(monthly);
  const lastGlobal = completed[completed.length - 1]?.month;
  if (!lastGlobal) return null;
  return `${formatMonth(shiftMonth(lastGlobal, -11))} – ${formatMonth(lastGlobal)}`;
}

// ---------------------------------------------------------------------------
// Ingresos
// ---------------------------------------------------------------------------

function IncomeSection({
  income,
  expCurrent,
  expPrev,
  expMonthly,
  movements,
  expenseMovements,
}: {
  income: ReturnType<typeof computeIncome>;
  expCurrent: number;
  expPrev: number;
  expMonthly: Array<{ month: string; total: number }>;
  movements: Movement[];
  expenseMovements: Movement[];
}) {
  const savingsCurrent = income.currentMonth - expCurrent;
  const savingsPrev = income.previousMonth - expPrev;
  const expByMonth = useMemo(() => new Map(expMonthly.map(p => [p.month, p.total])), [expMonthly]);
  // Media mensual de los últimos 12 MESES CALENDARIO y dividida entre 12: la
  // serie global solo contiene meses con movimientos, así que se ancla al
  // último mes ya terminado y se recorre el calendario (los meses vacíos
  // cuentan 0). El mes en curso, todavía en marcha, no cuenta.
  const last12Avg = useMemo(() => {
    const completed = completedMonths(income.monthly);
    const lastGlobal = completed[completed.length - 1]?.month;
    if (!lastGlobal) return 0;
    const [year, month] = lastGlobal.split('-').map(Number);
    const byMonth = new Map(income.monthly.map(p => [p.month, p.total]));
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(year, month - 1 - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      sum += byMonth.get(key) ?? 0;
    }
    return sum / 12;
  }, [income.monthly]);
  // Rellena hasta el mes en curso (no solo hasta el último mes con datos), para
  // que el mes actual aparezca en el eje aunque todavía no tenga movimientos.
  const chartData = useMemo(
    () =>
      monthlyChartData(
        monthlyExpenseSlice(fillMonthly(income.monthly, income.monthly[0]?.month, currentMonthKey())),
      ).map(p => ({
        ...p,
        expenses: expByMonth.get(p.month) ?? 0,
        savings: p.total - (expByMonth.get(p.month) ?? 0),
      })),
    [income.monthly, expByMonth]
  );

  const incomeMedian = useMemo(() => median(completedMonths(income.monthly).map(p => p.total)), [income.monthly]);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const visibleData = useMemo(
    () =>
      dateRange
        ? chartData.filter(p => p.month >= rangeMonth(dateRange.from) && p.month <= rangeMonth(dateRange.to))
        : chartData,
    [chartData, dateRange]
  );
  // Cuando el intervalo elegido no supera un mes, el eje pasa a ser diario:
  // se acumulan los movimientos de ese mes por día, se recorta a los días del
  // intervalo y se rellenan los días sin actividad con 0.
  const isDaily = dateRange ? dateRange.from.slice(0, 7) === dateRange.to.slice(0, 7) : false;
  // La media del intervalo se calcula por días cuando el rango no supera un mes
  // o cuando el intervalo personalizado usa fechas con día (para que mover el
  // inicio dentro de un mes cambie el resultado; la media de un intervalo
  // personalizado con más de un mes se expresa «por mes», contando solo los
  // días exactos del intervalo.
  const perDay = isDaily;
  const dailyData = useMemo(() => {
    if (!dateRange) return [] as typeof chartData;
    return computeDailySeries(rangeMonth(dateRange.from), movements, expenseMovements, null)
      .filter(p => p.date >= rangeFromDay(dateRange.from) && p.date <= rangeToDay(dateRange.to))
      .map(p => ({
        month: p.date,
        label: formatDay(p.date),
        total: p.income,
        expenses: p.expenses,
        savings: p.savings,
      }));
  }, [dateRange, movements, expenseMovements]);
  const chartRows = isDaily ? dailyData : visibleData;
  // Límites del intervalo «Sin filtro de tiempo»: de la fecha del primer
  // movimiento de ingresos al último mes de ingresos ya terminado (las mismas
  // fechas que usan las cards de esta sección).
  const todoBounds = useMemo(() => {
    const completed = [...income.monthly].map(p => p.month).filter(m => m < currentMonthKey()).sort();
    return { from: completed[0], to: completed[completed.length - 1] };
  }, [income.monthly]);

  const incomeTime = useDateRangeFilter(
    chartData[0]?.month ?? '',
    chartData[chartData.length - 1]?.month ?? '',
    setDateRange,
    todoBounds.from,
    todoBounds.to,
  );
  const intervalSummary = useMemo(() => {
    // En modo diario se usa la serie diaria del intervalo exacto, con 0 en los
    // días sin actividad. Con un intervalo personalizado por días de más de un
    // mes se cuentan solo los días exactos del intervalo pero la media se
    // expresa «por mes». Con meses (sin día o sin filtro) se usa la serie
    // mensual completa dentro del intervalo, para que las medias coincidan con
    // las de la gráfica de Gastos en las mismas condiciones. Sin filtro de
    // tiempo no se cuenta el mes en curso (aún incompleto); con un intervalo
    // seleccionado sí se incluye lo elegido.
    if (dateRange && isDaily) {
      const { days, income, expenses } = sumDailyRange(
        rangeFromDay(dateRange.from),
        rangeToDay(dateRange.to),
        movements,
        expenseMovements,
        null,
      );
      if (days <= 0) return null;
      return { income: income / days, expenses: expenses / days, savings: (income - expenses) / days };
    }
    if (dateRange && (DAY_FILTER.test(dateRange.from) || DAY_FILTER.test(dateRange.to))) {
      return averageMonthlyInRange(
        rangeFromDay(dateRange.from),
        rangeToDay(dateRange.to),
        movements,
        expenseMovements,
        null,
      );
    }
    const from = dateRange ? rangeMonth(dateRange.from) : todoBounds.from;
    const to = dateRange ? rangeMonth(dateRange.to) : todoBounds.to;
    if (!from || !to || from > to) return null;
    const avgIncome = averageInRange(income.monthly, from, to);
    const avgExpenses = averageInRange(expMonthly, from, to);
    return { income: avgIncome, expenses: avgExpenses, savings: avgIncome - avgExpenses };
  }, [isDaily, dateRange, movements, expenseMovements, income.monthly, expMonthly, todoBounds]);
  const selectedOverview = useMemo(() => {
    if (!selectedMonth) return undefined;
    return chartRows.find(p => p.month === selectedMonth);
  }, [chartRows, selectedMonth]);

  useEffect(() => {
    if (selectedMonth && !chartRows.some(p => p.month === selectedMonth)) {
      setSelectedMonth(null);
    }
  }, [selectedMonth, chartRows]);

  const handleBarClick = (bar: { payload?: { month?: string }; month?: string }) => {
    const month = bar?.payload?.month ?? bar?.month;
    if (!month) return;
    setSelectedMonth(prev => (prev === month ? null : month));
  };

  const sorted = useMemo(
    () => [...movements].sort((a, b) => b.date.localeCompare(a.date)),
    [movements]
  );
  const [page, setPage] = useState(1);
  const detailMovements = useMemo(() => {
    if (selectedMonth) return sorted.filter(m => m.date.startsWith(selectedMonth));
    if (dateRange) {
      const from = rangeFromDay(dateRange.from);
      const to = rangeToDay(dateRange.to);
      return sorted.filter(m => m.date >= from && m.date <= to);
    }
    return sorted;
  }, [sorted, selectedMonth, dateRange]);
  const totalPages = Math.max(1, Math.ceil(detailMovements.length / INCOME_PAGE_SIZE));
  const shown = detailMovements.slice((page - 1) * INCOME_PAGE_SIZE, page * INCOME_PAGE_SIZE);
  // Al cambiar los movimientos (p. ej. editar tipo/categoría) solo se recorta
  // la página actual si queda fuera de rango, en lugar de saltar a la página 1.
  useEffect(() => setPage(p => Math.min(p, Math.max(1, Math.ceil(detailMovements.length / INCOME_PAGE_SIZE)))), [detailMovements.length]);
  useEffect(() => setPage(1), [selectedMonth, dateRange]);

  return (
    <section className="space-y-4 pb-6">
      <h3 className="py-2 text-base font-bold text-gray-900 uppercase tracking-wider">Ingresos</h3>
      <div className="grid grid-cols-1 min-[500px]:grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Ingreso Medio Mensual" value={<>{formatSigned(income.averageMonthly)}/mes</>} variant="info" subtitle={`Mediana: ${formatSigned(incomeMedian)} · ${income.monthCount} meses`} />
        <SummaryCard
          label="Media último año"
          value={<>{formatSigned(last12Avg)}/mes</>}
          variant="neutral"
          subtitle={last12WindowLabel(income.monthly) ?? 'Últimos 12 meses'}
        />
        <SummaryCard
          label="Mes Actual"
          value={formatSigned(income.currentMonth)}
          variant="neutral"
          subtitle={
            <span>
              Capacidad de ahorro:{' '}
              <span className={`font-semibold ${savingsCurrent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatSigned(savingsCurrent)}
              </span>
            </span>
          }
        />
        <SummaryCard
          label="Mes Anterior"
          value={formatSigned(income.previousMonth)}
          variant="neutral"
          subtitle={
            <span>
              Capacidad de ahorro:{' '}
              <span className={`font-semibold ${savingsPrev >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatSigned(savingsPrev)}
              </span>
            </span>
          }
        />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 mb-3 mt-8">
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Ingresos por mes</h4>
          {chartData.length > 0 && (
            <>
              <div className="flex-1" />
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={incomeTime.preset}
                  onChange={v => incomeTime.selectPreset(v as DateRangePreset)}
                  ariaLabel="Filtro de tiempo"
                  className="w-44"
                  options={PRESET_LABELS.map(o => ({ value: o.value, label: o.label }))}
                />
              </div>
              {incomeTime.preset === 'custom' && (
                <CustomRangeInputs
                  from={incomeTime.customFrom}
                  to={incomeTime.customTo}
                  min={dayOf(todoBounds.from ?? chartData[0].month)}
                  onChange={incomeTime.applyCustom}
                />
              )}
            </>
          )}
        </div>
        <div className="relative">
        {/* La caja de medias solo se muestra con un intervalo explicitamente elegido */}
        {dateRange && intervalSummary && (
          <ChartRangeSummary
            income={intervalSummary.income}
            expenses={intervalSummary.expenses}
            savings={intervalSummary.savings}
            perDay={perDay}
          />
        )}
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartRows} margin={{ top: 5, right: 10, left: 4, bottom: 5 }}>
            <CartesianGrid stroke="#ececea" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9b9a95' }} interval={isDaily ? 2 : 'preserveStartEnd'} />
            <YAxis tick={{ fontSize: 11, fill: '#9b9a95' }} width={54} tickFormatter={v => formatAxisCurrency(v)} />
            {incomeTooltipRecharts()}
              <Bar
                dataKey="total"
                radius={[3, 3, 0, 0]}
                name="Ingresos"
                maxBarSize={40}
                onClick={handleBarClick}
                className="cursor-pointer"
                background={{ fill: 'transparent', stroke: 'none', cursor: 'pointer' }}
              >
                {chartRows.map(p => {
                  const isSelected = p.month === selectedMonth;
                  return (
                    <Cell
                      key={p.month}
                      fill="#00bc7d"
                      opacity={selectedMonth && !isSelected ? 0.35 : 1}
stroke={isSelected ? 'var(--color-gray-50)' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                    />
                );
              })}
</Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 mb-3 mt-8">
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Detalle de ingresos
            {selectedMonth
              ? ` · ${selectedMonth.length === 10 ? formatDay(selectedMonth) : fmtMonthLabel(selectedMonth)}`
              : dateRange
                ? ` · ${
                    rangeMonth(dateRange.from) === rangeMonth(dateRange.to)
                      ? fmtMonthLabel(rangeMonth(dateRange.from))
                      : `${fmtMonthLabel(rangeMonth(dateRange.from))} – ${fmtMonthLabel(rangeMonth(dateRange.to))}`
                  }`
                : ''}
          </h4>
          {selectedMonth ? (
            <button
              type="button"
              onClick={() => setSelectedMonth(null)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="w-3.5 h-3.5">
                <path d="M10.5 3.5 6 8l4.5 4.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Ver histórico
            </button>
          ) : dateRange ? (
            <button
              type="button"
              onClick={() => incomeTime.selectPreset('all')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="w-3.5 h-3.5">
                <path d="M10.5 3.5 6 8l4.5 4.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Ver histórico
            </button>
          ) : null}
        </div>
        {selectedMonth && selectedOverview && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <SummaryCard label="Ingresos" value={formatCurrency(selectedOverview.total)} variant="positive" />
            <SummaryCard
              label="Gastos"
              value={formatSigned(-selectedOverview.expenses)}
              variant={selectedOverview.expenses < 0 ? 'positive' : 'negative'}
              subtitle={
                selectedOverview.expenses < 0 ? 'Las devoluciones superan a los gastos.' : undefined
              }
            />
            <SummaryCard
              label="Capacidad de ahorro"
              value={formatSigned(selectedOverview.savings)}
              variant={selectedOverview.savings >= 0 ? 'positive' : 'negative'}
            />
          </div>
        )}
        {shown.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center border border-gray-100 rounded-xl bg-[#fdfdfe]">
            {selectedMonth || dateRange
              ? 'No hay ingresos en el periodo seleccionado.'
              : 'No hay ingresos registrados.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
            {shown.map(m => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-gray-700 truncate">{m.concept}</p>
                  <p className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                    {new Date(`${m.date}T00:00:00`).toLocaleDateString('es-ES')} · <BankLogo bank={m.bank} size={11} />
                    {BANK_LABELS[m.bank]}
                  </p>
                </div>
                <span className="text-emerald-700 font-semibold whitespace-nowrap">{formatSigned(m.amount)}</span>
              </li>
            ))}
          </ul>
        )}
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
  income,
  movements,
  incomeMovements,
  onChangeCategory,
  onBulkChangeCategory,
}: {
  data: ReturnType<typeof computeExpenses>;
  income: ReturnType<typeof computeIncome>;
  movements: Movement[];
  incomeMovements: Movement[];
  onChangeCategory: (id: string, category: string) => void;
  onBulkChangeCategory: (ids: string[], category: string) => void;
}) {
  const [expPage, setExpPage] = useState(1);
  const [expCategory, setExpCategory] = useState<string>('all');
  const [expBank, setExpBank] = useState<'all' | BankId>('all');
  const [expSearch, setExpSearch] = useState('');
  const [expDateRange, setExpDateRange] = useState<DateRange | null>(null);
  const [expSortKey, setExpSortKey] = useState<'date' | 'amount'>('date');
  const [expSortDir, setExpSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chartCategory, setChartCategory] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

  const last12Avg = useMemo(() => {
    // Media mensual de los últimos 12 MESES CALENDARIO y dividida entre 12: la
    // serie global solo contiene meses con movimientos, así que se ancla al
    // último mes ya terminado y se recorre el calendario (los meses vacíos
    // cuentan 0). El mes en curso, todavía en marcha, no cuenta.
    const completed = completedMonths(data.monthly);
    const lastGlobal = completed[completed.length - 1]?.month;
    if (!lastGlobal) return 0;
    const [year, month] = lastGlobal.split('-').map(Number);
    const byMonth = new Map(data.monthly.map(p => [p.month, p.total]));
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(year, month - 1 - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      sum += byMonth.get(key) ?? 0;
    }
    return sum / 12;
  }, [data.monthly]);

  const last12ByCategory = useMemo(() => {
    // Media mensual de los últimos 12 MESES CALENDARIO: se divide siempre entre
    // 12 (los meses sin gastos de una categoría contribuyen 0). La ventana se
    // ancla al último mes ya terminado y se recorre el calendario hacia
    // atrás, porque la serie por categoría solo contiene los meses que tienen
    // gastos y no se puede recortar con slice (sumaría meses fuera del año).
    const out: Record<string, number> = {};
    const byCat = data.monthlyByCategory;
    const completed = completedMonths(data.monthly);
    const lastGlobal = completed[completed.length - 1]?.month;
    if (!lastGlobal) return out;
    const [year, month] = lastGlobal.split('-').map(Number);
    const window: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(year, month - 1 - i, 1));
      window.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    for (const [cat, series] of Object.entries(byCat)) {
      const byMonth = new Map(series.map(p => [p.month, p.total]));
      let sum = 0;
      for (const mk of window) sum += byMonth.get(mk) ?? 0;
      out[cat] = sum / 12;
    }
    return out;
  }, [data.monthly, data.monthlyByCategory]);

  const monthCategories = useMemo(() => {
    const byMonth = new Map<string, Array<{ category: string; total: number }>>();
    for (const [cat, series] of Object.entries(data.monthlyByCategory)) {
      for (const p of series) {
        if (p.total === 0) continue;
        const list = byMonth.get(p.month) ?? [];
        list.push({ category: cat, total: p.total });
        byMonth.set(p.month, list);
      }
    }
    return byMonth;
  }, [data.monthlyByCategory]);

  const filteredByCategory = useMemo(() => {
    if (!dateRange) return data.byCategory;
    const from = rangeFromDay(dateRange.from);
    const to = rangeToDay(dateRange.to);
    const signedAbs = (m: Movement) => (m.type === 'refund' ? -1 : 1) * Math.abs(m.amount);
    const catTotals = new Map<string, { total: number; firstDate: string }>();
    for (const m of movements) {
      if (m.date < from || m.date > to) continue;
      const cat = m.category ?? 'Otros';
      if (cat === 'Excluido') continue;
      const entry = catTotals.get(cat) ?? { total: 0, firstDate: m.date };
      entry.total += signedAbs(m);
      if (m.date < entry.firstDate) entry.firstDate = m.date;
      catTotals.set(cat, entry);
    }
    const gross = [...catTotals.values()].reduce((s, e) => s + Math.max(e.total, 0), 0);
    const monthCount = Math.max(1, monthsBetween(rangeMonth(from), rangeMonth(to)).length);
    const origByCat = new Map(data.byCategory.map(c => [c.category, c]));
    return [...catTotals.entries()]
      .map(([cat, { total, firstDate }]) => {
        const orig = origByCat.get(cat);
        return {
          category: cat,
          total,
          pct: gross > 0 ? (Math.max(total, 0) / gross) * 100 : 0,
          averageMonthly: total / monthCount,
          firstDate,
          lastMonth: orig?.lastMonth ?? 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [dateRange, movements, data.byCategory]);

  const incomeByMonth = useMemo(() => new Map(income.monthly.map(p => [p.month, p.total])), [income.monthly]);
  const expenseChartData = useMemo(
    () => monthlyExpenseChartData(data, chartCategory, incomeByMonth),
    [data, chartCategory, incomeByMonth]
  );

  const visibleExpenseData = useMemo(
    () =>
      dateRange
        ? expenseChartData.filter(p => p.month >= rangeMonth(dateRange.from) && p.month <= rangeMonth(dateRange.to))
        : expenseChartData,
    [expenseChartData, dateRange]
  );
  // Cuando el intervalo elegido no supera un mes, el eje pasa a ser diario:
  // se acumulan los movimientos de ese mes por día (y de la categoría
  // seleccionada, si hay una), se recorta a los días del intervalo y se
  // rellenan los días sin actividad con 0.
  const isDaily = dateRange ? dateRange.from.slice(0, 7) === dateRange.to.slice(0, 7) : false;
  // La media del intervalo se calcula por días cuando el rango no supera un mes
  // o cuando el intervalo personalizado usa fechas con día (para que mover el
  // inicio dentro de un mes cambie el resultado; la media de un intervalo
  // personalizado con más de un mes se expresa «por mes», contando solo los
  // días exactos del intervalo.
  const perDay = isDaily;
  const dailyData = useMemo(() => {
    if (!dateRange) return [] as typeof visibleExpenseData;
    const cat = chartCategory === 'all' ? null : chartCategory;
    return computeDailySeries(rangeMonth(dateRange.from), incomeMovements, movements, cat)
      .filter(p => p.date >= rangeFromDay(dateRange.from) && p.date <= rangeToDay(dateRange.to))
      .map(p => ({
        month: p.date,
        label: formatDay(p.date),
        total: p.expenses,
        income: p.income,
        savings: p.savings,
      }));
  }, [dateRange, incomeMovements, movements, chartCategory]);
  const chartRows = isDaily ? dailyData : visibleExpenseData;
  // Límites del intervalo «Sin filtro de tiempo»: de la fecha del primer
  // movimiento de gastos al último mes de gastos ya terminado (las mismas
  // fechas que usan las cards de esta sección).
  const todoBounds = useMemo(() => {
    const completed = [...data.monthly].map(p => p.month).filter(m => m < currentMonthKey()).sort();
    return { from: completed[0], to: completed[completed.length - 1] };
  }, [data.monthly]);

  const chartTime = useDateRangeFilter(
    expenseChartData[0]?.month ?? '',
    expenseChartData[expenseChartData.length - 1]?.month ?? '',
    setDateRange,
    todoBounds.from,
    todoBounds.to,
  );
  const intervalSummary = useMemo(() => {
    // En modo diario se usa la serie diaria del intervalo exacto (y de la
    // categoría seleccionada, si la hay), con 0 en los días sin actividad. Con
    // un intervalo personalizado por días de más de un mes se cuentan solo los
    // días exactos del intervalo pero la media se expresa «por mes». Con meses
    // (sin día o sin filtro) se usa la serie mensual completa dentro del
    // intervalo (no la ventana que la gráfica muestra), para que las medias
    // coincidan con las de la gráfica de Ingresos en las mismas condiciones.
    // Sin filtro de tiempo no se cuenta el mes en curso (aún incompleto); con
    // un intervalo seleccionado sí se incluye lo elegido.
    if (dateRange && isDaily) {
      const cat = chartCategory === 'all' ? null : chartCategory;
      const { days, income, expenses } = sumDailyRange(
        rangeFromDay(dateRange.from),
        rangeToDay(dateRange.to),
        incomeMovements,
        movements,
        cat,
      );
      if (days <= 0) return null;
      return { income: income / days, expenses: expenses / days, savings: (income - expenses) / days };
    }
    if (dateRange && (DAY_FILTER.test(dateRange.from) || DAY_FILTER.test(dateRange.to))) {
      const cat = chartCategory === 'all' ? null : chartCategory;
      return averageMonthlyInRange(
        rangeFromDay(dateRange.from),
        rangeToDay(dateRange.to),
        incomeMovements,
        movements,
        cat,
      );
    }
    const expenseSeries = chartCategory === 'all' ? data.monthly : data.monthlyByCategory[chartCategory] ?? [];
    const from = dateRange ? rangeMonth(dateRange.from) : todoBounds.from;
    const to = dateRange ? rangeMonth(dateRange.to) : todoBounds.to;
    if (!from || !to || from > to) return null;
    const avgIncome = averageInRange(income.monthly, from, to);
    const avgExpenses = averageInRange(expenseSeries, from, to);
    return { income: avgIncome, expenses: avgExpenses, savings: avgIncome - avgExpenses };
  }, [isDaily, dateRange, incomeMovements, movements, chartCategory, income.monthly, data.monthly, data.monthlyByCategory, todoBounds]);

  useEffect(() => {
    if (selectedMonth && !chartRows.some(p => p.month === selectedMonth)) {
      setSelectedMonth(null);
    }
  }, [selectedMonth, chartRows]);

  const handleBarClick = (bar: { payload?: { month?: string }; month?: string }) => {
    const month = bar?.payload?.month ?? bar?.month;
    if (!month) return;
    setSelectedMonth(prev => (prev === month ? null : month));
  };

  const filteredMovements = useMemo(() => {
    const q = expSearch.trim().toLowerCase();
    const from = expDateRange ? rangeFromDay(expDateRange.from) : null;
    const to = expDateRange ? rangeToDay(expDateRange.to) : null;
    return movements
      .filter(m => expCategory === 'all' || (m.category ?? 'Otros') === expCategory)
      .filter(m => expBank === 'all' || m.bank === expBank)
      .filter(m => !from || m.date >= from)
      .filter(m => !to || m.date <= to)
      .filter(m => q.length === 0 || m.concept.toLowerCase().includes(q));
  }, [movements, expCategory, expBank, expSearch, expDateRange]);

  // Límites disponibles para el filtro de tiempo: del primer al último gasto.
  const expDateBounds = useMemo(() => {
    const dates = movements.map(m => m.date).sort();
    return { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' };
  }, [movements]);

  const expTime = useDateRangeFilter(expDateBounds.from, expDateBounds.to, range => setExpDateRange(range));

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

  useEffect(() => setExpPage(1), [expCategory, expBank, expSearch, expDateRange, expSortKey, expSortDir]);
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
      <h3 className="py-2 text-base font-bold text-gray-900 uppercase tracking-wider">Gastos</h3>
      <div className="grid grid-cols-1 min-[500px]:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* <SummaryCard label="Gasto Total" value={formatCurrency(data.total)} variant="negative" /> */}
        <SummaryCard label="Gasto Medio Mensual" value={<>{formatSigned(-data.averageMonthly)}/mes</>} variant="info" subtitle={`Mediana: ${formatSigned(-data.medianMonthly)} · ${data.monthCount} meses`} />
        <SummaryCard label="Media último año" value={<>{formatSigned(-last12Avg)}/mes</>} variant="neutral" subtitle={last12WindowLabel(data.monthly) ?? 'Últimos 12 meses'} />
        <SummaryCard
          label="Mes Actual"
          value={formatSigned(-data.currentMonth)}
          variant="neutral"
          subtitle={
            <span>
              Capacidad de ahorro:{' '}
              <span className={`font-semibold ${income.currentMonth - data.currentMonth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatSigned(income.currentMonth - data.currentMonth)}
              </span>
            </span>
          }
        />
        <SummaryCard
          label="Mes Anterior"
          value={formatSigned(-data.previousMonth)}
          variant="neutral"
          subtitle={
            <span>
              Capacidad de ahorro:{' '}
              <span className={`font-semibold ${income.previousMonth - data.previousMonth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatSigned(income.previousMonth - data.previousMonth)}
              </span>
            </span>
          }
        />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 mb-3 mt-8">
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Gastos por mes
          </h4>
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={chartCategory}
              onChange={setChartCategory}
              ariaLabel="Categoría del gráfico"
              className="w-52"
              options={[
                { value: 'all', label: 'Todas las categorías' },
                ...data.byCategory
                  .slice()
                  .sort((a, b) => a.category.localeCompare(b.category, 'es', { sensitivity: 'base' }))
                  .map(c => ({
                    value: c.category,
                    label: c.category,
                    icon: <ExpenseCategoryIcon category={c.category} size={12} />,
                  })),
              ]}
            />
            <Select
              value={chartTime.preset}
              onChange={v => chartTime.selectPreset(v as DateRangePreset)}
              ariaLabel="Filtro de tiempo"
              className="w-44"
              options={PRESET_LABELS.map(o => ({ value: o.value, label: o.label }))}
            />
          </div>
          {chartTime.preset === 'custom' && (
            <CustomRangeInputs
              from={chartTime.customFrom}
              to={chartTime.customTo}
              min={dayOf(todoBounds.from ?? expenseChartData[0]?.month ?? '')}
              onChange={chartTime.applyCustom}
            />
          )}
        </div>
        <div className="relative">
        {/* La caja de medias solo se muestra con un intervalo explicitamente elegido */}
        {dateRange && intervalSummary && (
          <ChartRangeSummary
            income={intervalSummary.income}
            expenses={intervalSummary.expenses}
            savings={intervalSummary.savings}
            perDay={perDay}
            categoryOnly={chartCategory !== 'all'}
            categoryLabel={chartCategory !== 'all' ? chartCategory : undefined}
          />
        )}
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartRows} margin={{ top: 5, right: 10, left: 4, bottom: 5 }}>
            <CartesianGrid stroke="#ececea" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9b9a95' }} interval={isDaily ? 2 : 'preserveStartEnd'} />
            <YAxis tick={{ fontSize: 11, fill: '#9b9a95' }} width={54} tickFormatter={v => formatAxisCurrency(v)} />
            {monthTooltipRecharts()}
            <Bar
              dataKey="total"
              radius={[3, 3, 0, 0]}
              name={chartCategory === 'all' ? 'Gastos' : chartCategory}
              maxBarSize={40}
              onClick={handleBarClick}
              className="cursor-pointer"
              background={{ fill: 'transparent', stroke: 'none', cursor: 'pointer' }}
            >
              {chartRows.map(p => {
                const isSelected = p.month === selectedMonth;
                return (
                  <Cell
                    key={p.month}
                    fill="#ff637e"
                    opacity={selectedMonth && !isSelected ? 0.35 : 1}
                    stroke={isSelected ? 'var(--color-gray-50)' : 'none'}
                    strokeWidth={isSelected ? 2 : 0}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      </div>

      {selectedMonth ? (
        <MonthCategoryBreakdown
          month={selectedMonth.length > 7 ? selectedMonth.slice(0, 7) : selectedMonth}
          categories={monthCategories.get(selectedMonth.length > 7 ? selectedMonth.slice(0, 7) : selectedMonth) ?? []}
          onClose={() => setSelectedMonth(null)}
        />
      ) : (
        <CategoryBreakdown
          categories={filteredByCategory}
          period={
            dateRange
              ? rangeMonth(dateRange.from) === rangeMonth(dateRange.to)
                ? fmtMonthLabel(rangeMonth(dateRange.from))
                : `${fmtMonthLabel(rangeMonth(dateRange.from))} – ${fmtMonthLabel(rangeMonth(dateRange.to))}`
              : undefined
          }
        />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0">
        <LastYearBreakdown avgByCategory={last12ByCategory} />
        <LastMonthBreakdown categories={data.byCategory} />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 mb-3 mt-8">
          <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Detalle de gastos
          </h4>
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={expSearch}
              onChange={e => setExpSearch(e.target.value)}
              placeholder="Buscar concepto…"
              className="px-3 py-1.5 border border-gray-200 rounded-xl text-sm w-44 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
            <Select
              value={expCategory}
              onChange={setExpCategory}
              ariaLabel="Filtrar por categoría"
              className="w-48"
              options={[
                { value: 'all', label: 'Todas las categorías' },
                ...EXPENSE_CATEGORY_LIST.map(c => ({
                  value: c,
                  label: c,
                  icon: <ExpenseCategoryIcon category={c} size={12} />,
                })),
              ]}
            />
            <Select
              value={expBank}
              onChange={v => setExpBank(v as 'all' | BankId)}
              ariaLabel="Filtrar por banco"
              className="w-44"
              options={[
                { value: 'all', label: 'Todos los bancos' },
                ...ORDERED_BANKS.map(b => ({ value: b.id, label: b.label, icon: <BankLogo bank={b.id} size={14} /> })),
              ]}
            />
            <Select
              value={expTime.preset}
              onChange={v => expTime.selectPreset(v as DateRangePreset)}
              ariaLabel="Filtro de tiempo"
              className="w-44"
              options={PRESET_LABELS.map(o => ({ value: o.value, label: o.label }))}
            />
          </div>
          {expTime.preset === 'custom' && (
            <CustomRangeInputs
              from={expTime.customFrom}
              to={expTime.customTo}
              min={expDateBounds.from}
              onChange={expTime.applyCustom}
            />
          )}
        </div>
        {bulkSelectedMovements.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 py-2 px-3 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900">
            <span className="text-sm font-semibold">
              {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Mover a:</span>
              <Select
                value=""
                placeholder="Elegir categoría…"
                ariaLabel="Mover movimientos a categoría"
                className="w-44"
                onChange={applyBulk}
                options={EXPENSE_CATEGORY_LIST.map(c => ({
                  value: c,
                  label: c,
                  icon: <ExpenseCategoryIcon category={c} size={12} />,
                }))}
              />
            </div>
            <button
              type="button"
              onClick={clearSelection}
              className="ml-auto px-3 py-1.5 rounded-xl bg-[#fdfdfe] text-sm font-semibold text-gray-900 hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              Limpiar
            </button>
          </div>
        )}
        {filteredMovements.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center border border-gray-100 rounded-xl bg-[#fdfdfe]">
            {expDateRange
              ? 'No hay gastos en el periodo seleccionado.'
              : expSearch || expCategory !== 'all' || expBank !== 'all'
                ? 'No hay gastos que coincidan con los filtros.'
                : 'No hay gastos registrados.'}
          </p>
) : (
        <>
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
            { title: 'Banco', align: 'left', className: 'min-w-[160px]' },
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
                <span className="flex items-center gap-2">
                  <ExpenseCategoryIcon category={m.category ?? 'Otros'} />
                  <span className="block max-w-[420px] whitespace-normal break-words">{m.concept}</span>
                </span>
              ),
            },
            { content: <span className="inline-flex items-center gap-2 whitespace-nowrap text-gray-500"><BankLogo bank={m.bank} size={18} />{BANK_LABELS[m.bank]}</span>, className: 'text-sm' },
            {
              content: (
                <Select
                  value={m.category ?? 'Otros'}
                  size="xs"
                  ariaLabel={`Categoría de ${m.concept}`}
                  className="w-[170px]"
                  onChange={v => onChangeCategory(m.id, v)}
                  options={EXPENSE_CATEGORY_LIST.map(c => ({
                    value: c,
                    label: c,
                    icon: <ExpenseCategoryIcon category={c} size={11} />,
                  }))}
                />
              ),
            },
            {
              content: m.type === 'refund' ? (
                <span className="text-emerald-600 font-semibold">{formatSigned(m.amount)}</span>
              ) : (
                <span className="text-red-600 font-semibold">{formatSigned(m.amount)}</span>
              ),
            },
          ])}
        />
        <Pagination page={expPage} totalPages={expTotalPages} onPageChange={setExpPage} />
        </>
        )}
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
      className="inline-flex items-center gap-1 uppercase tracking-wider font-bold cursor-pointer group text-gray-900"
    >
      {label}
      <span className="flex flex-col gap-[3px]">
        <svg
          width="12"
          height="6"
          viewBox="0 0 24 12"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          className={active && dir === 'asc' ? 'text-gray-900' : 'text-gray-300 group-hover:text-gray-400'}
        >
          <path strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" d="M4 9l8-8 8 8" />
        </svg>
        <svg
          width="12"
          height="6"
          viewBox="0 0 24 12"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          className={active && dir === 'desc' ? 'text-gray-900' : 'text-gray-300 group-hover:text-gray-400'}
        >
          <path strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" d="M4 3l8 8 8-8" />
        </svg>
      </span>
    </button>
  );
}

function MonthCategoryBreakdown({
  month,
  categories,
  onClose,
}: {
  month: string;
  categories: Array<{ category: string; total: number }>;
  onClose: () => void;
}) {
  const gross = categories.reduce((sum, c) => sum + Math.max(c.total, 0), 0);
  const total = categories.reduce((sum, c) => sum + c.total, 0);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 mt-8">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Por categoría · {fmtMonthLabel(month)}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="w-3.5 h-3.5">
            <path d="M10.5 3.5 6 8l4.5 4.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Ver histórico
        </button>
      </div>
      {categories.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">Sin gastos registrados este mes.</p>
      ) : (
        <ul className="space-y-2">
          {categories.map(c => {
            const isCredit = c.total < 0;
            const pct = c.total > 0 && gross > 0 ? (c.total / gross) * 100 : 0;
            return (
              <li key={c.category} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium text-gray-700">
                    <ExpenseCategoryIcon category={c.category} />
                    {c.category}
                  </span>
                  <span className="text-gray-600 text-right flex items-baseline justify-end gap-3">
                    <span>{signedExpenseFormat(c.total)}</span>
                    <span className="text-gray-400">{!isCredit && pct >= 0.05 ? `${pct.toFixed(1)}%` : ''}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isCredit ? 'bg-emerald-400/80' : 'bg-red-400/80'}`}
                    style={{ width: `${Math.max(1, Math.min(100, pct))}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-gray-400 mt-3">Total mes: {signedExpenseFormat(total)}</p>
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
        className="px-3 py-1 text-xs font-semibold rounded border border-gray-200 text-gray-600 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
        className="px-3 py-1 text-xs font-semibold rounded border border-gray-200 text-gray-600 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        Siguiente →
      </button>
    </div>
  );
}

function MovementsSection({
  movements,
  types,
  filter,
  bankFilter,
  search,
  onFilterChange,
  onBankFilterChange,
  onSearchChange,
  onChangeType,
  onBulkChangeType,
  onDelete,
  onRequestBulkDelete,
}: {
  movements: Movement[];
  types: MovementType[];
  filter: 'all' | MovementType;
  bankFilter: 'all' | BankId;
  search: string;
  onFilterChange: (v: 'all' | MovementType) => void;
  onBankFilterChange: (v: 'all' | BankId) => void;
  onSearchChange: (v: string) => void;
  onChangeType: (id: string, type: MovementType) => void;
  onBulkChangeType: (ids: string[], type: MovementType) => void;
  onDelete: (id: string) => void;
  onRequestBulkDelete: (ids: string[]) => void;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [movSortKey, setMovSortKey] = useState<'date' | 'amount'>('date');
  const [movSortDir, setMovSortDir] = useState<'asc' | 'desc'>('desc');
  const [pendingDelete, setPendingDelete] = useState<Movement | null>(null);
  const [movDateRange, setMovDateRange] = useState<DateRange | null>(null);

  // Límites disponibles para el filtro de tiempo: del primer al último movimiento.
  const movDateBounds = useMemo(() => {
    const dates = movements.map(m => m.date).sort();
    return { from: dates[0] ?? '', to: dates[dates.length - 1] ?? '' };
  }, [movements]);

  const movTime = useDateRangeFilter(movDateBounds.from, movDateBounds.to, range => setMovDateRange(range));

  const sortedMovements = useMemo(() => {
    const dir = movSortDir === 'asc' ? 1 : -1;
    const from = movDateRange ? rangeFromDay(movDateRange.from) : null;
    const to = movDateRange ? rangeToDay(movDateRange.to) : null;
    const list = [...movements]
      .filter(m => !from || m.date >= from)
      .filter(m => !to || m.date <= to);
    if (movSortKey === 'amount') {
      // Se ordena por el importe firmado: los valores negativos (gastos,
      // retiradas, compras) y las devoluciones quedan por debajo de 0.
      list.sort((a, b) => (a.amount - b.amount) * dir);
    } else {
      list.sort((a, b) => a.date.localeCompare(b.date) * dir);
    }
    return list;
  }, [movements, movSortKey, movSortDir, movDateRange]);

  const totalPages = Math.max(1, Math.ceil(sortedMovements.length / PAGE_SIZE));
  const shown = sortedMovements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Al cambiar orden/filtro se vuelve a la primera página; al cambiar los
  // movimientos (p. ej. editar tipo/categoría) solo se recorta la página actual
  // si queda fuera de rango, para no saltar a la página 1.
  useEffect(() => setPage(1), [movSortKey, movSortDir, movDateRange]);
  useEffect(() => setPage(p => Math.min(p, Math.max(1, Math.ceil(sortedMovements.length / PAGE_SIZE)))), [movements, movDateRange]);

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
          Todos los movimientos ({sortedMovements.length})
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={e => { onSearchChange(e.target.value); setPage(1); }}
            placeholder="Buscar concepto…"
            className="px-3 py-1.5 border border-gray-200 rounded-xl text-sm w-44 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
          <Select
            value={filter}
            onChange={v => { onFilterChange(v as 'all' | MovementType); setPage(1); }}
            ariaLabel="Filtrar por tipo"
            className="w-44"
            options={[
              { value: 'all', label: 'Todos los tipos' },
              ...types.map(t => ({ value: t, label: MOVEMENT_TYPE_LABELS[t] })),
            ]}
          />
          <Select
            value={bankFilter}
            onChange={v => { onBankFilterChange(v as 'all' | BankId); setPage(1); }}
            ariaLabel="Filtrar por banco"
            className="w-44"
            options={[
              { value: 'all', label: 'Todos los bancos' },
              ...ORDERED_BANKS.map(b => ({ value: b.id, label: b.label, icon: <BankLogo bank={b.id} size={14} /> })),
            ]}
          />
          <Select
            value={movTime.preset}
            onChange={v => { movTime.selectPreset(v as DateRangePreset); setPage(1); }}
            ariaLabel="Filtro de tiempo"
            className="w-44"
            options={PRESET_LABELS.map(o => ({ value: o.value, label: o.label }))}
          />
        </div>
        {movTime.preset === 'custom' && (
          <CustomRangeInputs
            from={movTime.customFrom}
            to={movTime.customTo}
            min={dayOf(movDateBounds.from)}
            onChange={movTime.applyCustom}
          />
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 py-2 px-3 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900">
          <span className="text-sm font-semibold">
            {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Cambiar tipo a:</span>
            <Select
              value=""
              placeholder="Elegir tipo…"
              ariaLabel="Cambiar tipo de los movimientos"
              className="w-44"
              onChange={v => applyBulk(v as MovementType)}
              options={ALL_MOVEMENT_TYPES.map(t => ({ value: t, label: MOVEMENT_TYPE_LABELS[t] }))}
            />
          </div>
          <button
            type="button"
            onClick={() => onRequestBulkDelete([...selected])}
            className="px-3 py-1.5 rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-700 transition-colors cursor-pointer"
          >
            Eliminar
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto px-3 py-1.5 rounded-xl bg-[#fdfdfe] text-sm font-semibold text-gray-900 hover:bg-zinc-200 transition-colors cursor-pointer"
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
            { title: 'Banco', align: 'left', className: 'min-w-[180px]' },
            { title: 'Tipo', align: 'left', className: 'min-w-[160px]' },
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
            { title: '', align: 'left', muted: true },
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
            { content: <span className="inline-flex items-center gap-2 whitespace-nowrap text-gray-500"><BankLogo bank={m.bank} size={18} />{BANK_LABELS[m.bank]}</span>, className: 'text-sm' },
            {
              content: (
                <Select
                  value={m.type}
                  size="xs"
                  ariaLabel={`Tipo de ${m.concept}`}
                  className="w-[140px]"
                  onChange={v => onChangeType(m.id, v as MovementType)}
                  options={ALL_MOVEMENT_TYPES.map(t => ({ value: t, label: MOVEMENT_TYPE_LABELS[t] }))}
                />
              ),
            },
            {
              content: (
                <Tooltip
                  text={`${m.concept}${m.shares !== undefined ? ` · ${formatQuantity(m.shares)} part.` : ''}${m.price !== undefined ? ` · ${formatQuantity(m.price)} €/part.` : ''}`}
                  className="cursor-default"
                >
                  <span className="block truncate max-w-[220px]">
                    {m.concept}
                    {(m.shares !== undefined || m.price !== undefined) && (
                      <span className="ml-2 text-xs text-gray-400">
                        {m.shares !== undefined ? `${formatQuantity(m.shares)} part.` : ''}
                        {m.price !== undefined ? ` @ ${formatQuantity(m.price)} €/part.` : ''}
                      </span>
                    )}
                  </span>
                </Tooltip>
              ),
            },
            {
              content: (
                <span className={
                  m.amount >= 0
                    ? 'text-emerald-700'
                    : 'text-gray-700'
                }>
                  {formatSigned(
                    m.type === 'interest'
                      ? interestNetAmount(m)
                      : m.amount
                  )}
                </span>
              ),
            },
            {
              content: (
                <Tooltip text="Eliminar movimiento">
                  <button
                    type="button"
                    onClick={() => setPendingDelete(m)}
                    aria-label="Eliminar movimiento"
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </button>
                </Tooltip>
              ),
            },
          ])}
        />
      )}
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Eliminar movimiento"
      >
        <p className="text-sm text-gray-700 leading-relaxed">
          ¿Eliminar el movimiento{' '}
          <span className="font-semibold text-gray-900">“{pendingDelete?.concept ?? ''}”</span>
          {pendingDelete
            ? ` del ${new Date(`${pendingDelete.date}T00:00:00`).toLocaleDateString('es-ES')}`
            : ''}?
        </p>
        <p className="text-sm text-gray-500 leading-relaxed mt-2">
          Esta acción no se puede deshacer.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (pendingDelete) onDelete(pendingDelete.id);
              setPendingDelete(null);
            }}
            className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors cursor-pointer"
          >
            Eliminar
          </button>
        </div>
      </Modal>
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

/** Datos para la gráfica «Gastos por mes», filtrando por categoría cuando se elige una.
 *  Se adjunta el ingreso y la capacidad de ahorro de cada mes para el hover. */
function monthlyExpenseChartData(
  data: ReturnType<typeof computeExpenses>,
  category: string,
  incomeByMonth: Map<string, number>,
) {
  const raw = category === 'all' ? data.monthly : data.monthlyByCategory[category] ?? [];
  // Se rellena todo el rango de actividad de gastos (meses con 0) hasta el mes
  // en curso incluido, de modo que los meses sin gasto en la categoría
  // seleccionada (o el mes actual sin movimientos) no desaparezcan del eje.
  const points = fillMonthly(raw, data.monthly[0]?.month, currentMonthKey());
  return monthlyChartData(monthlyExpenseSlice(points)).map(p => ({
    ...p,
    income: incomeByMonth.get(p.month) ?? 0,
    savings: (incomeByMonth.get(p.month) ?? 0) - p.total,
  }));
}

function monthTooltipRecharts() {
  return (
    <RechartsTooltip
      cursor={{ fill: 'rgba(0,0,0,0.04)' }}
      wrapperStyle={{ zIndex: 20 }}
      content={
        <ChartTooltip
          renderContent={payload => {
            const p = payload[0]?.payload;
            return (
              <IncomeExpenseTooltip
                label={String(p?.label ?? '')}
                income={Number(p?.income ?? 0)}
                expenses={Number(p?.total ?? 0)}
                savings={Number(p?.savings ?? 0)}
              />
            );
          }}
        />
      }
    />
  );
}

function incomeTooltipRecharts() {
  return (
    <RechartsTooltip
      cursor={{ fill: 'rgba(0,0,0,0.04)' }}
      wrapperStyle={{ zIndex: 20 }}
      content={
        <ChartTooltip
          renderContent={payload => {
            const p = payload[0]?.payload;
            return (
              <IncomeExpenseTooltip
                label={String(p?.label ?? '')}
                income={Number(p?.total ?? 0)}
                expenses={Number(p?.expenses ?? 0)}
                savings={Number(p?.savings ?? 0)}
              />
            );
          }}
        />
      }
    />
  );
}
