import React, { useMemo, useState } from 'react';
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
    <div className="flex flex-col gap-2.5">
      <label className="text-base font-semibold text-gray-900">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        className="px-6 py-4 bg-white border border-gray-300 rounded-xl backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-500 text-base"
      />
      {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
    </div>
  );
}

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function CheckboxField({ label, checked, onChange }: Readonly<CheckboxFieldProps>) {
  return (
    <label className="flex items-center gap-3 cursor-pointer py-3 px-4 rounded-lg hover:bg-gray-100/50 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 text-gray-600 border-gray-300 rounded focus:ring-2 focus:ring-gray-500 cursor-pointer"
      />
      <span className="text-sm font-medium text-gray-900">{label}</span>
    </label>
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
    <section className="space-y-6">
      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">{title}</h3>
      <div className={`grid ${colsClass} gap-8`}>{children}</div>
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
    <article className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 backdrop-blur-md rounded-xl p-6 sm:p-7 transition-all hover:shadow-md hover:border-gray-300">
      <div className="text-4xl mb-4">{icon}</div>
      <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
      <p className="text-2xl sm:text-3xl font-bold text-gray-900 break-words">{value}</p>
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
    <div className="min-h-screen bg-gradient-to-br from-white via-gray-50 to-white py-16 sm:py-20 md:py-28 px-6 sm:px-8 lg:px-12">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-16 sm:mb-20 md:mb-28">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-4 sm:mb-6 tracking-tight">
            Simulador de Ahorros
          </h1>
          <p className="text-lg sm:text-xl text-gray-600 max-w-2xl">
            Proyecta tu patrimonio con precisión financiera
          </p>
        </header>

        {/* Main Layout - Full Width Stacked */}
        <div className="flex flex-col gap-12 md:gap-16">
          {/* Form Section */}
          <section className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-12 sm:p-14 shadow-md">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-14">Parámetros</h2>

            <form className="space-y-14" onSubmit={(e) => { e.preventDefault(); handleCalculate(); }}>
              <FormSection title="Ahorros Iniciales" cols="double">
                <InputField
                  label="Ahorros Totales Iniciales"
                  value={params.initialTotalSavings}
                  onChange={(v) => handleInputChange('initialTotalSavings', v)}
                  hint="antes de la compra de la vivienda"
                />
                <article className="bg-gray-100 rounded-xl p-6 border border-gray-200">
                  <p className="text-sm font-medium text-gray-600 mb-2">Ahorro Inicial Disponible para Invertir</p>
                  <p className={`text-2xl font-bold ${initialAvailableForInvestment >= 0 ? 'text-gray-900' : 'text-red-700'}`}>
                    {formatCurrency(initialAvailableForInvestment)}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Ahorros totales - gastos finales + hipoteca concedida + préstamo familiar
                  </p>
                </article>
                <InputField
                  label="Cuenta Remunerada Inicial"
                  value={initialAllocationInputs.savingsAccount}
                  onChange={(v) => handleAllocationChange('savingsAccount', v)}
                  type="text"
                  hint="usa % o importe (ej: 40% o 25000)"
                />
                <InputField
                  label="Inversiones Iniciales"
                  value={initialAllocationInputs.investments}
                  onChange={(v) => handleAllocationChange('investments', v)}
                  type="text"
                  hint="usa % o importe (ej: 60% o 37500)"
                />
                <div className="md:col-span-2 bg-gray-100 border border-gray-300 rounded-xl p-5">
                  <p className={`text-sm font-medium ${allocationStatus.colorClass}`}>{allocationStatus.message}</p>
                </div>
              </FormSection>

              <div className="border-t border-gray-200"></div>

              <FormSection title="Costes de Casa" cols="double">
                <article className="md:col-span-2 bg-gray-100 rounded-xl p-6 border border-gray-200">
                  <p className="text-sm font-medium text-gray-600 mb-2">Gastos Finales de la Casa</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalHouseExpenses)}</p>
                </article>
                <InputField
                  label="Coste Base"
                  value={params.baseCost}
                  onChange={(v) => handleInputChange('baseCost', v)}
                />
                <InputField
                  label="Comisión Inmobiliaria"
                  value={params.realEstatePercentage}
                  onChange={(v) => handleInputChange('realEstatePercentage', v)}
                  step="0.1"
                  hint="en %"
                />
                <div className="md:col-span-2">
                  <CheckboxField
                    label="Obra Nueva (11.2% vs 6.5%)"
                    checked={params.isNewBuild}
                    onChange={(v) => handleInputChange('isNewBuild', v)}
                  />
                </div>
                <InputField
                  label="Reforma y Muebles"
                  value={params.reformCosts + params.furnitureCosts}
                  onChange={(v) => {
                    const total = Number.parseFloat(v) || 0;
                    handleInputChange('reformCosts', total * 0.75);
                    handleInputChange('furnitureCosts', total * 0.25);
                  }}
                  hint="distribución: 75% reforma, 25% muebles"
                />
              </FormSection>

              <div className="border-t border-gray-200"></div>

              <FormSection title="Hipoteca" cols="triple">
                <InputField
                  label="Cuota Mensual"
                  value={params.monthlyMortgagePayment}
                  onChange={(v) => handleInputChange('monthlyMortgagePayment', v)}
                  hint="en €"
                />
                <InputField
                  label="TAE"
                  value={params.mortgageAnnualRate}
                  onChange={(v) => handleInputChange('mortgageAnnualRate', v)}
                  step="0.1"
                  hint="tasa anual en %"
                />
                <InputField
                  label="Duración"
                  value={params.mortgageDurationYears}
                  onChange={(v) => handleInputChange('mortgageDurationYears', v)}
                  hint="en años"
                />
              </FormSection>

              <FormSection title="Préstamo Familiar (0% interés)" cols="triple">
                <InputField
                  label="Importe Total"
                  value={params.familyLoanAmount}
                  onChange={(v) => handleInputChange('familyLoanAmount', v)}
                  hint="en €"
                />
                <InputField
                  label="Duración"
                  value={params.familyLoanDurationYears}
                  onChange={(v) => handleInputChange('familyLoanDurationYears', v)}
                  hint="en años"
                />
              </FormSection>

              <div className="border-t border-gray-200"></div>

              <FormSection title="Ahorros Mensuales" cols="triple">
                <InputField
                  label="Aporte Total"
                  value={params.monthlyContribution}
                  onChange={(v) => handleInputChange('monthlyContribution', v)}
                  hint="en € / mes"
                />
                <InputField
                  label="Rentabilidad Cuenta"
                  value={params.savingsAccountRate}
                  onChange={(v) => handleInputChange('savingsAccountRate', v)}
                  step="0.1"
                  hint="% anual"
                />
                <InputField
                  label="Rentabilidad Inversiones"
                  value={params.investmentRate}
                  onChange={(v) => handleInputChange('investmentRate', v)}
                  step="0.1"
                  hint="% anual"
                />
                  
                <div className="md:col-span-3 bg-gray-100 border border-gray-300 backdrop-blur-sm rounded-xl p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <p className="text-base font-semibold text-gray-900">Distribución por tramos</p>
                    <label className="flex items-center gap-2 cursor-pointer">
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
                        className="w-4 h-4 text-gray-600 border-gray-300 rounded cursor-pointer"
                      />
                      <span className="text-sm font-medium text-gray-700">Igual en todos los tramos</span>
                    </label>
                  </div>
                  {(sameDistributionForAll ? [params.distributionPeriods[0] ?? 50] : params.distributionPeriods).map((pct, i) => {
                    const fromYear = i * 10 + 1;
                    const toYear = Math.min((i + 1) * 10, params.timeHorizonYears);
                    const periodKey = sameDistributionForAll ? 'all' : `period-${fromYear}-${toYear}`;
                    return (
                      <div key={periodKey} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-700">
                            {sameDistributionForAll ? 'Todos los años' : `Años ${fromYear}–${toYear}`}
                          </p>
                          <span className="text-sm font-bold text-gray-700">
                            {pct}% cuenta | {100 - pct}% inversiones
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={pct}
                          onChange={(e) => handleDistributionChange(i, Number(e.target.value))}
                          className="w-full h-2 bg-gray-400 rounded-lg appearance-none cursor-pointer accent-gray-700"
                        />
                      </div>
                    );
                  })}
                  <p className="text-xs text-gray-600">Cuenta ← → Inversiones</p>
                </div>
              </FormSection>

              <div className="border-t border-gray-200"></div>

              <FormSection title="Horizonte" cols="single">
                <InputField
                  label="Años a Simular"
                  value={params.timeHorizonYears}
                  onChange={(v) => handleInputChange('timeHorizonYears', v)}
                />
              </FormSection>

              <button
                type="submit"
                disabled={!hasValidInitialAllocation}
                className="w-full py-5 px-8 bg-gradient-to-r from-gray-900 to-gray-800 hover:from-gray-950 hover:to-gray-900 disabled:from-gray-500 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg text-lg sm:text-xl mt-4"
              >
                Calcular Proyección
              </button>
            </form>
          </section>

          {/* Results Section */}
          <main>
            {result && (
              <div className="space-y-12">
                {/* Results Grid */}
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  <ResultCard label="Total Ahorrado" value={formatCurrency(result.totalSavings)} icon="💰" />
                  <ResultCard label="Cuenta Remunerada" value={formatCurrency(result.finalSavingsAccount)} icon="🏦" />
                  <ResultCard label="Inversiones" value={formatCurrency(result.finalInvestments)} icon="📈" />
                </section>

                {/* Details Section */}
                <section className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-12 sm:p-14 shadow-md">
                  <h3 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-10">Detalles de la Proyección</h3>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Gastos Casa</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900 break-words">{formatCurrency(result.totalHouseExpenses)}</p>
                    </article>
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Hipoteca Concedida (estimada)</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900 break-words">{formatCurrency(result.mortgageGrantedAmount)}</p>
                    </article>
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Ahorro Inicial Invertible</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900 break-words">{formatCurrency(result.initialAvailableForInvestment)}</p>
                    </article>
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Hipoteca</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900">{params.mortgageDurationYears} años</p>
                    </article>
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Aporte Mensual</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900 break-words">{formatCurrency(params.monthlyContribution)}</p>
                    </article>
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Horizonte</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900">{params.timeHorizonYears} años</p>
                    </article>
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Préstamo Familiar</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900">{hasFamilyLoan ? 'Activo' : 'No activo'}</p>
                    </article>
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Cuota Familiar</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900 break-words">{formatCurrency(familyLoanMonthlyPayment)}</p>
                    </article>
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Inicio Familiar</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900">En paralelo con hipoteca</p>
                    </article>
                    <article className="bg-gray-100 rounded-xl p-7 sm:p-8 border border-gray-200">
                      <p className="text-sm font-medium text-gray-600 mb-4">Duración Familiar</p>
                      <p className="text-xl sm:text-2xl font-bold text-gray-900">{params.familyLoanDurationYears} años</p>
                    </article>
                  </div>
                </section>

                {/* Breakdown Table */}
                <section className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl overflow-hidden shadow-md">
                  <button
                    onClick={() => setShowDetail(!showDetail)}
                    className="w-full px-12 sm:px-14 py-7 sm:py-8 flex items-center justify-between hover:bg-gray-100 transition-colors border-b border-gray-200"
                  >
                    <h3 className="text-xl sm:text-2xl font-bold text-gray-900">Desglose Anual</h3>
                    <svg className={`w-6 h-6 text-gray-600 transition-transform flex-shrink-0 ${showDetail ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </button>

                  {showDetail && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-full">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-100">
                            <th className="px-8 sm:px-10 py-5 text-left text-sm font-bold text-gray-900">Año</th>
                            <th className="px-8 sm:px-10 py-5 text-right text-sm font-bold text-gray-900">Cuenta</th>
                            <th className="px-8 sm:px-10 py-5 text-right text-sm font-bold text-gray-900">Inversiones</th>
                            <th className="px-8 sm:px-10 py-5 text-right text-sm font-bold text-gray-900">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {result.monthlyBreakdown
                            .filter(m => m.month === 12 || m.year === params.timeHorizonYears)
                            .map((entry) => (
                              <tr key={`${entry.year}-${entry.month}`} className="hover:bg-gray-50 transition-colors">
                                <td className="px-8 sm:px-10 py-5 text-base font-medium text-gray-900">{entry.year}º</td>
                                <td className="px-8 sm:px-10 py-5 text-right text-base text-gray-700">{formatCurrency(entry.savingsAccount)}</td>
                                <td className="px-8 sm:px-10 py-5 text-right text-base text-gray-700">{formatCurrency(entry.investments)}</td>
                                <td className="px-8 sm:px-10 py-5 text-right text-base font-semibold text-gray-900">{formatCurrency(entry.savingsAccount + entry.investments)}</td>
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
