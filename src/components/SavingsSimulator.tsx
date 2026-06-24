import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import {
  calculateMortgageGrantedAmount,
  calculateSavings,
  calculateTotalHouseExpenses,
  formatCurrency,
  type SavingsParams,
  type SavingsResult,
} from '../lib/calculations';

interface InputFieldProps {
  label: string;
  value: number | string;
  onChange: (value: string) => void;
  type?: 'number' | 'text';
  step?: string;
  hint?: string;
}

function InputField({ label, value, onChange, type = 'number', step, hint }: Readonly<InputFieldProps>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        className="px-3.5 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all text-gray-900 text-sm"
      />
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

interface HouseTypeFieldProps {
  isNewBuild: boolean;
  onChange: (isNewBuild: boolean) => void;
}

function HouseTypeField({ isNewBuild, onChange }: Readonly<HouseTypeFieldProps>) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Tipo de vivienda</legend>
      <p className="text-xs text-gray-500">Obra nueva 11.2% · A reformar 6.5%</p>
      <div className="flex gap-2">
        <label className="flex items-center gap-2 cursor-pointer py-2 px-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors text-xs font-medium text-gray-900">
          <input
            type="radio"
            name="houseType"
            checked={isNewBuild}
            onChange={() => onChange(true)}
            className="w-3.5 h-3.5 text-gray-700 border-gray-300 focus:ring-2 focus:ring-gray-500 cursor-pointer"
          />
          Obra nueva
        </label>
        <label className="flex items-center gap-2 cursor-pointer py-2 px-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors text-xs font-medium text-gray-900">
          <input
            type="radio"
            name="houseType"
            checked={!isNewBuild}
            onChange={() => onChange(false)}
            className="w-3.5 h-3.5 text-gray-700 border-gray-300 focus:ring-2 focus:ring-gray-500 cursor-pointer"
          />
          A reformar
        </label>
      </div>
    </fieldset>
  );
}

interface FormSectionProps {
  title: string;
  children: React.ReactNode;
  cols?: 'single' | 'double' | 'triple';
}

function FormSection({ title, children, cols = 'single' }: Readonly<FormSectionProps>) {
  const colsClass = {
    single: 'grid-cols-1',
    double: 'grid-cols-1 md:grid-cols-2',
    triple: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  }[cols];

  return (
    <section className="space-y-3 -mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200 pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider">{title}</h3>
      <div className={`grid ${colsClass} gap-3`}>{children}</div>
    </section>
  );
}

interface ResultCardProps {
  label: string;
  value: string;
  icon: string;
}

function ResultCard({ label, value, icon }: Readonly<ResultCardProps>) {
  return (
    <article className="bg-white border border-gray-200 rounded-lg p-4 transition-all hover:shadow-sm hover:border-gray-300">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-gray-900 break-words">{value}</p>
    </article>
  );
}

interface ParsedInitialAllocation {
  amount: number;
  isValid: boolean;
}

interface AllocationStatus {
  colorClass: string;
  message: string;
}

function parseInitialAllocation(value: string, availableAmount: number): ParsedInitialAllocation {
  const normalizedValue = value.trim().replace(',', '.');
  if (!normalizedValue) {
    return { amount: 0, isValid: false };
  }

  const isPercentage = normalizedValue.endsWith('%');
  const rawNumber = isPercentage ? normalizedValue.slice(0, -1).trim() : normalizedValue;
  const parsed = Number.parseFloat(rawNumber);

  if (Number.isNaN(parsed) || parsed < 0) {
    return { amount: 0, isValid: false };
  }

  if (isPercentage) {
    if (parsed > 100) {
      return { amount: 0, isValid: false };
    }

    return {
      amount: Math.max(0, availableAmount) * (parsed / 100),
      isValid: true,
    };
  }

  return {
    amount: parsed,
    isValid: true,
  };
}

function getInitialAllocationStatus(
  parsedSavingsAccount: ParsedInitialAllocation,
  parsedInvestments: ParsedInitialAllocation,
  initialAvailableForInvestment: number,
  allocationDifference: number,
): AllocationStatus {
  if (!parsedSavingsAccount.isValid || !parsedInvestments.isValid) {
    return {
      colorClass: 'text-red-700',
      message: 'Introduce valores válidos para ambos campos iniciales (porcentaje o importe).',
    };
  }

  if (initialAvailableForInvestment < 0) {
    return {
      colorClass: 'text-red-700',
      message: 'Los ahorros iniciales no cubren la operación de compra. Ajusta coste, hipoteca o ahorros totales.',
    };
  }

  if (Math.abs(allocationDifference) > 0.01) {
    if (allocationDifference > 0) {
      return {
        colorClass: 'text-amber-700',
        message: `Faltan por asignar ${formatCurrency(Math.abs(allocationDifference))}.`,
      };
    }

    return {
      colorClass: 'text-red-700',
      message: `La suma supera el disponible por ${formatCurrency(Math.abs(allocationDifference))}.`,
    };
  }

  return {
    colorClass: 'text-green-700',
    message: 'Distribución inicial válida: cuenta + inversiones = ahorro disponible.',
  };
}

export default function SavingsSimulator() {
  const [params, setParams] = useState<SavingsParams>({
    initialTotalSavings: 440000,
    initialSavingsAccount: 30000,
    initialInvestments: 0,
    baseCost: 450000,
    realEstatePercentage: 2.5,
    isNewBuild: false,
    reformCosts: 76500,
    furnitureCosts: 25500,
    monthlyMortgagePayment: 1500,
    mortgageAnnualRate: 2.9,
    mortgageDurationYears: 30,
    familyLoanAmount: 0,
    familyLoanDurationYears: 0,
    monthlyContribution: 2119,
    savingsAccountRate: 2,
    investmentRate: 7,
    timeHorizonYears: 30,
    distributionPeriods: [50, 0, 0],
  });

  const [initialAllocationInputs, setInitialAllocationInputs] = useState(() => {
    const defaultTotalHouseExpenses = calculateTotalHouseExpenses({
      baseCost: 450000,
      realEstatePercentage: 2.5,
      isNewBuild: false,
      reformCosts: 76500,
      furnitureCosts: 25500,
    });
    const defaultMortgageGranted = calculateMortgageGrantedAmount(1500, 2.9, 30);
    const defaultAvailable = 440000 - defaultTotalHouseExpenses + defaultMortgageGranted;
    const savingsDefault = 30000;
    const investmentsDefault = Math.max(0, Math.round((defaultAvailable - savingsDefault) * 100) / 100);
    return {
      savingsAccount: String(savingsDefault),
      investments: String(investmentsDefault),
    };
  });
  const [result, setResult] = useState<SavingsResult | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [sameDistributionForAll, setSameDistributionForAll] = useState(false);

  // Sync distributionPeriods length when timeHorizonYears changes
  React.useEffect(() => {
    const numPeriods = Math.max(1, Math.ceil(params.timeHorizonYears / 10));
    setParams(prev => {
      if (prev.distributionPeriods.length === numPeriods) return prev;
      const updated = [...prev.distributionPeriods];
      while (updated.length < numPeriods) updated.push(0);
      return { ...prev, distributionPeriods: updated.slice(0, numPeriods) };
    });
  }, [params.timeHorizonYears]);

  const hasFamilyLoan = params.familyLoanAmount > 0 && params.familyLoanDurationYears > 0;

  const familyLoanMonthlyPayment = hasFamilyLoan
    ? params.familyLoanAmount / (params.familyLoanDurationYears * 12)
    : 0;

  const totalHouseExpenses = useMemo(() => calculateTotalHouseExpenses(params), [params]);
  const mortgageGrantedAmount = useMemo(
    () =>
      calculateMortgageGrantedAmount(
        params.monthlyMortgagePayment,
        params.mortgageAnnualRate,
        params.mortgageDurationYears,
      ),
    [params.monthlyMortgagePayment, params.mortgageAnnualRate, params.mortgageDurationYears],
  );
  const effectiveFamilyLoan =
    params.familyLoanAmount > 0 && params.familyLoanDurationYears > 0 ? params.familyLoanAmount : 0;
  const initialAvailableForInvestment = params.initialTotalSavings - totalHouseExpenses + mortgageGrantedAmount + effectiveFamilyLoan;

  const parsedInitialSavingsAccount = useMemo(
    () => parseInitialAllocation(initialAllocationInputs.savingsAccount, initialAvailableForInvestment),
    [initialAllocationInputs.savingsAccount, initialAvailableForInvestment],
  );
  const parsedInitialInvestments = useMemo(
    () => parseInitialAllocation(initialAllocationInputs.investments, initialAvailableForInvestment),
    [initialAllocationInputs.investments, initialAvailableForInvestment],
  );

  const totalInitialAllocation = parsedInitialSavingsAccount.amount + parsedInitialInvestments.amount;
  const allocationDifference = initialAvailableForInvestment - totalInitialAllocation;
  const allocationStatus = useMemo(
    () =>
      getInitialAllocationStatus(
        parsedInitialSavingsAccount,
        parsedInitialInvestments,
        initialAvailableForInvestment,
        allocationDifference,
      ),
    [parsedInitialSavingsAccount, parsedInitialInvestments, initialAvailableForInvestment, allocationDifference],
  );
  const hasValidInitialAllocation =
    initialAvailableForInvestment >= 0
    && parsedInitialSavingsAccount.isValid
    && parsedInitialInvestments.isValid
    && Math.abs(allocationDifference) <= 0.01;

  function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { year: number; contributed: number; total: number } }> }) {
    if (!active || !payload?.[0]) return null;
    const { year, contributed, total } = payload[0].payload;
    return (
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', fontFamily: 'Heebo, sans-serif' }}>
        <p style={{ fontWeight: 700, marginBottom: 4, color: '#111827' }}>{year === 0 ? 'Inicio' : `Año ${year}`}</p>
        <p style={{ color: '#22c55e', marginBottom: 2 }}>{formatCurrency(total)}</p>
        <p style={{ color: '#6b7280', marginBottom: 2 }}>{formatCurrency(contributed)}</p>
        <p style={{ color: '#aeb0b4' }}>(+ {formatCurrency(total - contributed)})</p>
      </div>
    );
  }

  const chartData = useMemo(() => {
    if (!result) return [];
    const initialTotal = result.initialAvailableForInvestment;
    let cumulativeContributions = initialTotal;
    const dataPoints: Array<{ year: number; contributed: number; total: number }> = [
      { year: 0, contributed: Math.round(initialTotal * 100) / 100, total: Math.round(initialTotal * 100) / 100 },
    ];
    const lastIndex = result.monthlyBreakdown.length - 1;
    for (let i = 0; i < result.monthlyBreakdown.length; i++) {
      const entry = result.monthlyBreakdown[i];
      cumulativeContributions += entry.savingsToAccount + entry.savingsToInvestment;
      if (entry.month === 12 || i === lastIndex) {
        const totalBalance = entry.savingsAccount + entry.investments;
        dataPoints.push({
          year: entry.year,
          contributed: Math.round(cumulativeContributions * 100) / 100,
          total: Math.round(totalBalance * 100) / 100,
        });
      }
    }
    return dataPoints;
  }, [result]);

  const handleAllocationChange = (field: 'savingsAccount' | 'investments', value: string) => {
    const normalizedValue = value.trim().replace(',', '.');
    const isPercentage = normalizedValue.endsWith('%');
    const rawNumber = isPercentage ? normalizedValue.slice(0, -1).trim() : normalizedValue;
    const parsed = Number.parseFloat(rawNumber);
    const isValid = !Number.isNaN(parsed) && parsed >= 0 && (!isPercentage || parsed <= 100);

    if (!isValid) {
      setInitialAllocationInputs(prev => ({ ...prev, [field]: value }));
      return;
    }

    const otherValue = isPercentage
      ? `${Math.max(0, 100 - parsed)}%`
      : String(Math.max(0, Math.round((initialAvailableForInvestment - parsed) * 100) / 100));

    if (field === 'savingsAccount') {
      setInitialAllocationInputs({ savingsAccount: value, investments: otherValue });
    } else {
      setInitialAllocationInputs({ savingsAccount: otherValue, investments: value });
    }
  };

  const handleDistributionChange = (periodIndex: number, value: number) => {
    if (sameDistributionForAll) {
      setParams(prev => ({ ...prev, distributionPeriods: prev.distributionPeriods.map(() => value) }));
    } else {
      setParams(prev => {
        const updated = [...prev.distributionPeriods];
        updated[periodIndex] = value;
        return { ...prev, distributionPeriods: updated };
      });
    }
  };

  const handleCalculate = () => {
    if (!hasValidInitialAllocation) {
      return;
    }

    const paramsWithInitialAllocation: SavingsParams = {
      ...params,
      initialSavingsAccount: parsedInitialSavingsAccount.amount,
      initialInvestments: parsedInitialInvestments.amount,
    };

    const newResult = calculateSavings(paramsWithInitialAllocation);
    setParams(paramsWithInitialAllocation);
    setResult(newResult);
  };

  const handleInputChange = (field: keyof SavingsParams, value: any) => {
    setParams(prev => ({
      ...prev,
      [field]: typeof value === 'string' ? Number.parseFloat(value) || 0 : value,
    }));
  };

  React.useEffect(() => {
    handleCalculate();
  }, []);

  return (
    <div className="min-h-screen py-6 px-3 sm:px-4 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <header className="mb-6 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
            Simulador de Ahorros
          </h1>
        </header>

        {/* Main Layout */}
        <div className="flex flex-col gap-6 md:gap-8">
          {/* Form Section */}
          <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); handleCalculate(); }}>
              <FormSection title="Ahorros Iniciales" cols="double">
                <InputField
                  label="Ahorros Totales Iniciales (€)"
                  value={params.initialTotalSavings}
                  onChange={(v) => handleInputChange('initialTotalSavings', v)}
                  hint="Antes de comprar la vivienda"
                />
                <article className="bg-emerald-50 rounded-lg px-4 py-3 border border-emerald-200">
                  <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">Disponible para Invertir</p>
                  <p className={`text-xl font-bold ${initialAvailableForInvestment >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatCurrency(initialAvailableForInvestment)}
                  </p>
                  <p className="text-xs text-emerald-600 mt-1">
                    Ahorros totales − gastos finales + hipoteca concedida + préstamo familiar
                  </p>
                </article>
                <InputField
                  label="Cuenta Remunerada Inicial (% o €)"
                  value={initialAllocationInputs.savingsAccount}
                  onChange={(v) => handleAllocationChange('savingsAccount', v)}
                  type="text"
                  hint="Ej: 40% o 25000"
                />
                <InputField
                  label="Inversiones Iniciales (% o €)"
                  value={initialAllocationInputs.investments}
                  onChange={(v) => handleAllocationChange('investments', v)}
                  type="text"
                  hint="Ej: 60% o 37500"
                />
                <div className="md:col-span-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
                  <p className={`text-xs font-medium ${allocationStatus.colorClass}`}>{allocationStatus.message}</p>
                </div>
              </FormSection>

              <FormSection title="Costes de Casa" cols="double">
                <InputField
                  label="Coste Base (€)"
                  value={params.baseCost}
                  onChange={(v) => handleInputChange('baseCost', v)}
                />
                <InputField
                  label="Comisión Inmobiliaria (%)"
                  value={params.realEstatePercentage}
                  onChange={(v) => handleInputChange('realEstatePercentage', v)}
                  step="0.1"
                />
                <InputField
                  label="Reforma y Muebles (€)"
                  value={params.reformCosts + params.furnitureCosts}
                  onChange={(v) => {
                    const total = Number.parseFloat(v) || 0;
                    handleInputChange('reformCosts', total * 0.75);
                    handleInputChange('furnitureCosts', total * 0.25);
                  }}
                />
                <div className="md:col-span-2">
                  <HouseTypeField
                    isNewBuild={params.isNewBuild}
                    onChange={(v) => handleInputChange('isNewBuild', v)}
                  />
                </div>
                <article className="md:col-span-2 bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Gastos Finales de la Casa</p>
                  <p className="text-xl font-bold text-gray-900">{formatCurrency(totalHouseExpenses)}</p>
                </article>
              </FormSection>

              <FormSection title="Financiación" cols="triple">
                <InputField
                  label="Cuota Hipoteca Mensual (€)"
                  value={params.monthlyMortgagePayment}
                  onChange={(v) => handleInputChange('monthlyMortgagePayment', v)}
                />
                <InputField
                  label="TAE Hipoteca (%)"
                  value={params.mortgageAnnualRate}
                  onChange={(v) => handleInputChange('mortgageAnnualRate', v)}
                  step="0.1"
                />
                <InputField
                  label="Duración Hipoteca (años)"
                  value={params.mortgageDurationYears}
                  onChange={(v) => handleInputChange('mortgageDurationYears', v)}
                />
                <article className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Préstamo Hipotecario Estimado</p>
                  <p className="text-xl font-bold text-gray-900">{formatCurrency(mortgageGrantedAmount)}</p>
                </article>
                <InputField
                  label="Préstamo Familiar (€)"
                  value={params.familyLoanAmount}
                  onChange={(v) => handleInputChange('familyLoanAmount', v)}
                  hint="0% interés"
                />
                <InputField
                  label="Duración Préstamo (años)"
                  value={params.familyLoanDurationYears}
                  onChange={(v) => handleInputChange('familyLoanDurationYears', v)}
                />
              </FormSection>

              <FormSection title="Ahorros Mensuales" cols="triple">
                <InputField
                  label="Aporte Total Mensual (€)"
                  value={params.monthlyContribution}
                  onChange={(v) => handleInputChange('monthlyContribution', v)}
                  hint={`${params.monthlyMortgagePayment} € hipoteca ${hasFamilyLoan && familyLoanMonthlyPayment ? `| ${familyLoanMonthlyPayment.toFixed(2)} € préstamo familiar` : ''} | ${(params.monthlyContribution - params.monthlyMortgagePayment - (familyLoanMonthlyPayment ?? 0)).toFixed(2)} € inversiones`}
                />
                <InputField
                  label="Rentabilidad Cuenta (%)"
                  value={params.savingsAccountRate}
                  onChange={(v) => handleInputChange('savingsAccountRate', v)}
                  step="0.1"
                />
                <InputField
                  label="Rentabilidad Inversiones (%)"
                  value={params.investmentRate}
                  onChange={(v) => handleInputChange('investmentRate', v)}
                  step="0.1"
                />
                  
                <div className="md:col-span-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Distribución por tramos</p>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sameDistributionForAll}
                        onChange={(e) => {
                          setSameDistributionForAll(e.target.checked);
                          if (e.target.checked) {
                            const first = params.distributionPeriods[0] ?? 50;
                            setParams(prev => ({ ...prev, distributionPeriods: prev.distributionPeriods.map(() => first) }));
                          }
                        }}
                        className="w-3.5 h-3.5 text-gray-600 border-gray-300 rounded cursor-pointer"
                      />
                      <span className="text-xs font-medium text-gray-700">Igual en todos</span>
                    </label>
                  </div>
                  {(sameDistributionForAll ? [params.distributionPeriods[0] ?? 50] : params.distributionPeriods).map((pct, i) => {
                    const fromYear = i * 10 + 1;
                    const toYear = Math.min((i + 1) * 10, params.timeHorizonYears);
                    const periodKey = sameDistributionForAll ? 'all' : `period-${fromYear}-${toYear}`;
                    return (
                      <div key={periodKey} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-gray-700">
                            {sameDistributionForAll ? 'Todos los años' : `Años ${fromYear}–${toYear}`}
                          </p>
                          <span className="text-xs font-semibold text-gray-700">
                            {pct}% cuenta | {100 - pct}% inversiones
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={pct}
                          onChange={(e) => handleDistributionChange(i, Number(e.target.value))}
                          className="w-full h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-gray-700"
                        />
                      </div>
                    );
                  })}
                  <p className="text-xs text-gray-500">Cuenta ← → Inversiones</p>
                </div>
              </FormSection>

              <FormSection title="Horizonte" cols="single">
                <InputField
                  label="Años a Simular"
                  value={params.timeHorizonYears}
                  onChange={(v) => handleInputChange('timeHorizonYears', v)}
                />
              </FormSection>

              <div className="flex justify-center">
                <button
                  type="submit"
                  disabled={!hasValidInitialAllocation}
                  className="cursor-pointer py-2.5 px-8 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all text-sm"
                >
                  Calcular Proyección
                </button>
              </div>
            </form>
          </section>

          {/* Results Section */}
          <main>
            {result && (
              <div className="space-y-6">
                {/* Results Grid */}
                <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <ResultCard label="Total Ahorrado" value={formatCurrency(result.totalSavings)} icon="💰" />
                  <ResultCard label="Cuenta Remunerada" value={formatCurrency(result.finalSavingsAccount)} icon="🏦" />
                  <ResultCard label="Inversiones" value={formatCurrency(result.finalInvestments)} icon="📈" />
                </section>

                {/* Details Section */}
                <section className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 shadow-sm">
                  <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider mb-4">Detalles de la Proyección</h3>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                      <p className="text-xs font-medium text-gray-600 mb-1">Ahorro Inicial Invertible</p>
                      <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(result.initialAvailableForInvestment)}</p>
                    </article>
                    <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                      <p className="text-xs font-medium text-gray-600 mb-1">Aporte Mensual</p>
                      <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(params.monthlyContribution)}</p>
                    </article>
                    <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                      <p className="text-xs font-medium text-gray-600 mb-1">Coste Casa</p>
                      <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(result.totalHouseExpenses)}</p>
                    </article>
                    <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                      <p className="text-xs font-medium text-gray-600 mb-1">Préstamo Hipotecario</p>
                      <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(result.mortgageGrantedAmount)}</p>
                    </article>
                    <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                      <p className="text-xs font-medium text-gray-600 mb-1">Cuota Hipoteca</p>
                      <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(params.monthlyMortgagePayment)}</p>
                    </article>
                    <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                      <p className="text-xs font-medium text-gray-600 mb-1">Duración Hipoteca</p>
                      <p className="text-base font-bold text-gray-900">{params.mortgageDurationYears} años</p>
                    </article>
                    { hasFamilyLoan ?
                      (<>
                        <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                          <p className="text-xs font-medium text-gray-600 mb-1">Cuota Préstamo Familiar</p>
                          <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(familyLoanMonthlyPayment)}</p>
                        </article>
                        <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-medium text-gray-600 mb-1">Duración Préstamo Familiar</p>
                          <p className="text-base font-bold text-gray-900">{params.familyLoanDurationYears} años</p>
                        </article>
                      </>) : (
                      <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-medium text-gray-600 mb-1">Préstamo Familiar</p>
                        <p className="text-base font-bold text-gray-900">Activo</p>
                      </article>
                      )
                    }
                    <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                      <p className="text-xs font-medium text-gray-600 mb-1">Horizonte</p>
                      <p className="text-base font-bold text-gray-900">{params.timeHorizonYears} años</p>
                    </article>
                  </div>
                </section>

                {/* Breakdown Table */}
                <section className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <button
                    onClick={() => setShowDetail(!showDetail)}
                    className="w-full px-5 sm:px-6 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
                  >
                    <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider">Desglose Anual</h3>
                    <svg className={`cursor-pointer w-4 h-4 text-gray-600 transition-transform flex-shrink-0 ${showDetail ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </button>

                  {showDetail && (
                    <div className="p-5 sm:p-6 border-b border-gray-200">
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-4">
                        Aportado vs Total
                      </h4>
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis
                            dataKey="year"
                            tick={{ fontSize: 12, fill: '#6b7280', fontFamily: 'Heebo, sans-serif' }}
                            tickFormatter={(v: number) => v === 0 ? 'Inicio' : `${v}º`}
                            stroke="#d1d5db"
                          />
                          <YAxis
                            tick={{ fontSize: 12, fill: '#6b7280', fontFamily: 'Heebo, sans-serif' }}
                            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k €`}
                            stroke="#d1d5db"
                          />
                          <Tooltip content={<ChartTooltip />} />
                          <Legend wrapperStyle={{ fontFamily: 'Heebo, sans-serif', fontSize: '12px' }} />
                          <Line type="monotone" dataKey="contributed" name="Aportado" stroke="#6b7280" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="total" name="Total" stroke="#22c55e" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    )}
                  {showDetail && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-full">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-3 sm:px-5 py-3 text-left text-xs font-bold text-gray-900 uppercase tracking-wider">Año</th>
                            <th className="px-3 sm:px-5 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider">Cuenta</th>
                            <th className="px-3 sm:px-5 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider">Inversiones</th>
                            <th className="px-3 sm:px-5 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {result.monthlyBreakdown
                            .filter((m, i, arr) => m.month === 12 || i === arr.length - 1)
                            .map((entry) => (
                              <tr key={`${entry.year}-${entry.month}`} className="hover:bg-gray-50 transition-colors">
                                <td className="px-3 sm:px-5 py-2.5 text-sm font-medium text-gray-900">{entry.year}º</td>
                                <td className="px-3 sm:px-5 py-2.5 text-right text-sm text-gray-700">{formatCurrency(entry.savingsAccount)}</td>
                                <td className="px-3 sm:px-5 py-2.5 text-right text-sm text-gray-700">{formatCurrency(entry.investments)}</td>
                                <td className="px-3 sm:px-5 py-2.5 text-right text-sm font-semibold text-gray-900">{formatCurrency(entry.savingsAccount + entry.investments)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
