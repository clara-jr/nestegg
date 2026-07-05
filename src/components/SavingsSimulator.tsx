import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import {
  calculateMortgageGrantedAmount,
  calculateSavings,
  calculateTotalHouseExpenses,
  formatCurrency,
  type SavingsParams,
  type SavingsResult,
} from '../lib/calculations';
import { getSimulatorData, setSimulatorData, subscribe, useLocalStorage } from '../lib/sharedStore';

interface InputFieldProps {
  label: string;
  value: number | string;
  onChange: (value: string) => void;
  type?: 'number' | 'text';
  step?: string;
  hint?: string;
  disabled?: boolean;
  disabledTitle?: string;
  error?: string;
}

function InputField({ label, value, onChange, type = 'number', step, hint, disabled, disabledTitle, error }: Readonly<InputFieldProps>) {
  const [raw, setRaw] = useState(() => String(value ?? ''));
  const isFocused = useRef(false);

  useEffect(() => {
    if (!isFocused.current) {
      setRaw(String(value ?? ''));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRaw(e.target.value);
    onChange(e.target.value);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className={`text-xs font-semibold uppercase tracking-wider ${disabled ? 'text-gray-400' : error ? 'text-red-700' : 'text-gray-600'}`}>{label}</label>
      {disabled && disabledTitle ? (
        <InfoTip text={disabledTitle}>
          <input
            type={type}
            value={raw}
            onChange={handleChange}
            onFocus={() => { isFocused.current = true; }}
            onBlur={() => { isFocused.current = false; setRaw(String(value ?? '')); }}
            step={step}
            disabled
            className={`px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all text-sm bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed w-full disabled:pointer-events-none`}
          />
        </InfoTip>
      ) : (
        <input
          type={type}
          value={raw}
          onChange={handleChange}
          onFocus={() => { isFocused.current = true; }}
          onBlur={() => { isFocused.current = false; setRaw(String(value ?? '')); }}
          step={step}
          disabled={disabled}
          className={`px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all text-sm ${
            disabled
              ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
              : error
                ? 'bg-white border-red-400 text-gray-900 focus:ring-red-400'
                : 'bg-white border-gray-300 text-gray-900 focus:ring-gray-500 focus:border-transparent'
          }`}
        />
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && hint && <p className={`text-xs ${disabled ? 'text-gray-400' : 'text-gray-500'}`}>{hint}</p>}
    </div>
  );
}

function InfoTip({ text, children }: { text: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [open]);

  return (
    <span
      ref={ref}
      onClick={() => setOpen(!open)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className="relative inline-flex items-center cursor-pointer"
    >
      {children}
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs leading-tight whitespace-nowrap shadow-lg z-50 pointer-events-none normal-case tracking-normal font-normal text-left">
          {text}
        </span>
      )}
    </span>
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
      <p className="text-xl font-bold text-gray-900 break-words">{value}</p>
    </article>
  );
}

interface ParsedInitialAllocation {
  amount: number;
  isValid: boolean;
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

export default function SavingsSimulator() {
  const [params, setParams] = useLocalStorage<SavingsParams>('savings-params', {
    initialTotalSavings: 0,
    initialSavingsAccount: 0,
    initialInvestments: 0,
    baseCost: 0,
    realEstatePercentage: 2.5,
    isNewBuild: false,
    reformCosts: 0,
    furnitureCosts: 0,
    monthlyMortgagePayment: 0,
    mortgageAnnualRate: 2.9,
    mortgageDurationYears: 30,
    familyLoanAmount: 0,
    familyLoanDurationYears: 0,
    monthlyContribution: 0,
    savingsAccountRate: 2,
    investmentRate: 7,
    timeHorizonYears: 30,
    distributionPeriods: [50, 0, 0],
  });

  const [initialAllocationInputs, setInitialAllocationInputs] = useLocalStorage('savings-initial-inputs', {
    savingsAccount: '0',
    investments: '0',
  });
  const [showDetail, setShowDetail] = useState(false);
  const [sameDistributionForAll, setSameDistributionForAll] = useState(false);
  const [includeHousePurchase, setIncludeHousePurchase] = useState(false);

  const handleToggleHousePurchase = (include: boolean) => {
    setIncludeHousePurchase(include);
  };

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

  useEffect(() => {
    setSimulatorData({ monthlyContribution: params.monthlyContribution });
  }, [params.monthlyContribution]);

  useEffect(() => {
    setSimulatorData({ initialSavings: params.initialTotalSavings });
  }, [params.initialTotalSavings]);

  useEffect(() => {
    const unsub = subscribe(() => {
      const sd = getSimulatorData();
      setParams(prev => {
        const updates: Partial<SavingsParams> = {};
        if (prev.mortgageAnnualRate !== sd.mortgageAPR && sd.mortgageAPR > 0) updates.mortgageAnnualRate = sd.mortgageAPR;
        if (prev.realEstatePercentage !== sd.realEstatePercentage && sd.realEstatePercentage > 0) updates.realEstatePercentage = sd.realEstatePercentage;
        if (prev.initialTotalSavings !== sd.initialSavings && sd.initialSavings > 0) updates.initialTotalSavings = sd.initialSavings;
        if (Object.keys(updates).length === 0) return prev;
        return { ...prev, ...updates };
      });
    });
    return unsub;
  }, []);

  const hasFamilyLoan = params.familyLoanAmount > 0 && params.familyLoanDurationYears > 0;

  const familyLoanMonthlyPayment = hasFamilyLoan
    ? params.familyLoanAmount / (params.familyLoanDurationYears * 12)
    : 0;

  const monthlyHint = useMemo(() => {
    const parts: string[] = [];
    const total = params.monthlyContribution + params.monthlyMortgagePayment + (hasFamilyLoan ? familyLoanMonthlyPayment : 0);
    if (params.monthlyMortgagePayment > 0) {
      parts.push(`la hipoteca (${formatCurrency(params.monthlyMortgagePayment)}/mes)`);
    }
    if (hasFamilyLoan) {
      parts.push(`el préstamo familiar (${formatCurrency(familyLoanMonthlyPayment)}/mes)`);
    }
    if (parts.length === 0) return undefined;
    return `Al terminar de pagar ${parts.join(' y ')}, ese importe se redirige al ahorro mensual (${formatCurrency(total)}/mes).`;
  }, [params.monthlyMortgagePayment, hasFamilyLoan, familyLoanMonthlyPayment]);

  useEffect(() => {
    setSimulatorData({
      monthlyMortgagePayment: params.monthlyMortgagePayment,
      mortgageDurationYears: params.mortgageDurationYears,
      familyLoanMonthlyPayment,
      familyLoanDurationYears: params.familyLoanDurationYears,
    });
  }, [params.monthlyMortgagePayment, params.mortgageDurationYears, familyLoanMonthlyPayment, params.familyLoanDurationYears]);


  const totalHouseExpenses = useMemo(() => calculateTotalHouseExpenses(params), [params]);
  const mortgageGrantedAmount = useMemo(
    () =>
      params.baseCost > 0
        ? calculateMortgageGrantedAmount(
            params.monthlyMortgagePayment,
            params.mortgageAnnualRate,
            params.mortgageDurationYears,
          )
        : 0,
    [params.baseCost, params.monthlyMortgagePayment, params.mortgageAnnualRate, params.mortgageDurationYears],
  );
  const mortgageExceedsBase = params.baseCost > 0 && mortgageGrantedAmount > params.baseCost
    ? `El préstamo hipotecario (${formatCurrency(mortgageGrantedAmount)}) supera el coste base (${formatCurrency(params.baseCost)})`
    : undefined;
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

  const computeError = (parsed: ParsedInitialAllocation, amount: number): string | undefined => {
    if (!parsed.isValid) return 'Introduce un valor válido';
    if (initialAvailableForInvestment < 0 && amount > 0) return 'No hay disponible para invertir';
    if (initialAvailableForInvestment >= 0 && amount > initialAvailableForInvestment + 0.01) return 'Supera el disponible para invertir';
    return undefined;
  };

  let savingsError = computeError(parsedInitialSavingsAccount, parsedInitialSavingsAccount.amount);
  let investmentsError = computeError(parsedInitialInvestments, parsedInitialInvestments.amount);

  if (!savingsError && !investmentsError && initialAvailableForInvestment >= 0 && allocationDifference < -0.01) {
    if (parsedInitialSavingsAccount.amount > 0) savingsError = 'Supera el disponible para invertir';
    if (parsedInitialInvestments.amount > 0) investmentsError = 'Supera el disponible para invertir';
  }

  const hasValidInitialAllocation =
    initialAvailableForInvestment >= 0
    && parsedInitialSavingsAccount.isValid
    && parsedInitialInvestments.isValid
    && Math.abs(allocationDifference) <= 0.01;

  const paramsForCalculation = useMemo<SavingsParams>(() => ({
    ...params,
    initialSavingsAccount: hasValidInitialAllocation ? parsedInitialSavingsAccount.amount : 0,
    initialInvestments: hasValidInitialAllocation ? parsedInitialInvestments.amount : 0,
    monthlyMortgagePayment: params.baseCost > 0 ? params.monthlyMortgagePayment : 0,
    mortgageDurationYears: params.baseCost > 0 ? params.mortgageDurationYears : 0,
  }), [params, parsedInitialSavingsAccount.amount, parsedInitialInvestments.amount, hasValidInitialAllocation]);

  const result = useMemo<SavingsResult | null>(() => {
    if (!hasValidInitialAllocation) return null;
    return calculateSavings(paramsForCalculation);
  }, [paramsForCalculation, hasValidInitialAllocation]);

  useEffect(() => {
    if (!result) return;
    setSimulatorData({
      initialSavingsAccount: result.initialSavingsAccount,
      initialInvestments: result.initialInvestments,
    });
  }, [result?.initialSavingsAccount, result?.initialInvestments]);

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

  const handleReformaMueblesChange = (value: string) => {
    const total = Number.parseFloat(value) || 0;
    const newReform = Math.round(total * 0.75 * 100) / 100;
    const newFurniture = Math.round(total * 0.25 * 100) / 100;

    setParams(prev => ({
      ...prev,
      reformCosts: newReform,
      furnitureCosts: newFurniture,
    }));

    const newHouseExpenses = calculateTotalHouseExpenses({
      baseCost: params.baseCost,
      realEstatePercentage: params.realEstatePercentage,
      isNewBuild: params.isNewBuild,
      reformCosts: newReform,
      furnitureCosts: newFurniture,
    });
    const newMortgageGranted = params.baseCost > 0
      ? calculateMortgageGrantedAmount(
          params.monthlyMortgagePayment,
          params.mortgageAnnualRate,
          params.mortgageDurationYears,
        )
      : 0;
    const newFamilyLoan = params.familyLoanAmount > 0 && params.familyLoanDurationYears > 0
      ? params.familyLoanAmount
      : 0;
    const newAvailable = params.initialTotalSavings - newHouseExpenses + newMortgageGranted + newFamilyLoan;

    if (newAvailable < 0) return;

    const normalizedSavings = initialAllocationInputs.savingsAccount.trim().replace(',', '.');
    if (normalizedSavings.endsWith('%')) return;

    if (newAvailable === 0) {
      setInitialAllocationInputs({ savingsAccount: '0', investments: '0' });
      return;
    }

    const parsedSavings = parseInitialAllocation(initialAllocationInputs.savingsAccount, newAvailable);
    if (!parsedSavings.isValid) return;

    if (parsedSavings.amount > newAvailable) {
      setInitialAllocationInputs({ savingsAccount: String(Math.round(newAvailable * 100) / 100), investments: '0' });
    } else {
      const investmentsAmount = Math.round((newAvailable - parsedSavings.amount) * 100) / 100;
      setInitialAllocationInputs(prev => ({ ...prev, investments: String(investmentsAmount) }));
    }
  };

  const handleInputChange = (field: keyof SavingsParams, value: any) => {
    const numericValue = typeof value === 'string' ? Number.parseFloat(value) || 0 : value;

    setParams(prev => {
      const updated = {
        ...prev,
        [field]: numericValue,
      };
      if (field === 'baseCost' && numericValue === 0) {
        updated.monthlyMortgagePayment = 0;
        updated.mortgageDurationYears = 0;
      }
      if (field === 'familyLoanAmount' && numericValue === 0) {
        updated.familyLoanDurationYears = 0;
      }
      return updated;
    });

    // When a field that affects Disponible para Invertir changes,
    // keep Cuenta Remunerada fixed and recalculate Inversiones (unless in % mode)
    const availableFields: Partial<Record<keyof SavingsParams, true>> = {
      initialTotalSavings: true, baseCost: true, realEstatePercentage: true, isNewBuild: true,
      reformCosts: true, furnitureCosts: true, monthlyMortgagePayment: true, mortgageAnnualRate: true,
      mortgageDurationYears: true, familyLoanAmount: true, familyLoanDurationYears: true,
    };
    if (!availableFields[field]) return;

    const newHouseExpenses = calculateTotalHouseExpenses({
      baseCost: field === 'baseCost' ? numericValue : params.baseCost,
      realEstatePercentage: field === 'realEstatePercentage' ? numericValue : params.realEstatePercentage,
      isNewBuild: field === 'isNewBuild' ? !!value : params.isNewBuild,
      reformCosts: field === 'reformCosts' ? numericValue : params.reformCosts,
      furnitureCosts: field === 'furnitureCosts' ? numericValue : params.furnitureCosts,
    });
    const newMortgageGranted = (field === 'baseCost' ? numericValue : params.baseCost) > 0
      ? calculateMortgageGrantedAmount(
          field === 'monthlyMortgagePayment' ? numericValue : params.monthlyMortgagePayment,
          field === 'mortgageAnnualRate' ? numericValue : params.mortgageAnnualRate,
          field === 'mortgageDurationYears' ? numericValue : params.mortgageDurationYears,
        )
      : 0;
    const famAmt = field === 'familyLoanAmount' ? numericValue : params.familyLoanAmount;
    const famDur = field === 'familyLoanDurationYears' ? numericValue : params.familyLoanDurationYears;
    const newFamilyLoan = famAmt > 0 && famDur > 0 ? famAmt : 0;
    const newTotal = field === 'initialTotalSavings' ? numericValue : params.initialTotalSavings;
    const newAvailable = newTotal - newHouseExpenses + newMortgageGranted + newFamilyLoan;

    if (newAvailable < 0) return;

    const normalizedSavings = initialAllocationInputs.savingsAccount.trim().replace(',', '.');
    if (normalizedSavings.endsWith('%')) return;

    if (newAvailable === 0) {
      setInitialAllocationInputs({ savingsAccount: '0', investments: '0' });
      return;
    }

    const parsedSavings = parseInitialAllocation(initialAllocationInputs.savingsAccount, newAvailable);
    if (!parsedSavings.isValid) return;

    if (parsedSavings.amount > newAvailable) {
      setInitialAllocationInputs({ savingsAccount: String(Math.round(newAvailable * 100) / 100), investments: '0' });
    } else {
      const investmentsAmount = Math.round((newAvailable - parsedSavings.amount) * 100) / 100;
      setInitialAllocationInputs(prev => ({ ...prev, investments: String(investmentsAmount) }));
    }
  };


  return (
    <div className="min-h-screen py-6 px-3 sm:px-4 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {/* Main Layout */}
        <div className="flex flex-col gap-6 md:gap-8">
          {/* Form Section */}
          <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); }}>
              <FormSection title="Ahorros Iniciales" cols="double">
                <InputField
                  label="Ahorros Totales Iniciales (€)"
                  value={params.initialTotalSavings}
                  onChange={(v) => handleInputChange('initialTotalSavings', v)}
                />
                {(params.baseCost > 0 || hasFamilyLoan || mortgageGrantedAmount > 0 || params.reformCosts > 0 || params.furnitureCosts > 0) && (
                <article className={`rounded-lg px-4 py-3 border ${initialAvailableForInvestment >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${initialAvailableForInvestment >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>Disponible para Invertir</p>
                  <p className={`text-xl font-bold ${initialAvailableForInvestment >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatCurrency(initialAvailableForInvestment)}
                  </p>
                  <p className={`text-xs mt-1 ${initialAvailableForInvestment >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    Ahorros totales − gastos finales + hipoteca concedida + préstamo familiar
                  </p>
                </article>
                )}
                <div className="md:col-span-2 space-y-3">
                  {/*<h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Reparto de los ahorros iniciales:</h4>*/}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <InputField
                  label="Cuenta Remunerada Inicial (% o €)"
                  value={initialAllocationInputs.savingsAccount}
                  onChange={(v) => handleAllocationChange('savingsAccount', v)}
                  type="text"
                  hint={initialAvailableForInvestment <= 0 ? `${params.initialTotalSavings <= 0 ? 'Introduce ahorros totales' : 'No hay ahorros disponibles'} para invertir · Ej: 40% o 25000` : "Ej: 40% o 25000"}
                  error={savingsError}
                  disabled={initialAvailableForInvestment <= 0}
                  disabledTitle="No hay disponible para invertir"
                />
                <InputField
                  label="Inversiones Iniciales (% o €)"
                  value={initialAllocationInputs.investments}
                  onChange={(v) => handleAllocationChange('investments', v)}
                  type="text"
                  hint={initialAvailableForInvestment <= 0 ? `${params.initialTotalSavings <= 0 ? 'Introduce ahorros totales' : 'No hay ahorros disponibles'} para invertir · Ej: 60% o 37500` : "Ej: 60% o 37500"}
                  error={investmentsError}
                  disabled={initialAvailableForInvestment <= 0}
                  disabledTitle="No hay disponible para invertir"
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
                  </div>
                </div>
              </FormSection>

              <FormSection title="Ahorros Mensuales" cols="triple">
                  <InputField
                    label="Aporte Total Mensual (€)"
                    value={params.monthlyContribution}
                    onChange={(v) => handleInputChange('monthlyContribution', v)}
                    hint="Importe destinado íntegramente a cuenta remunerada e inversiones."
                  />
                  
                <div className="md:col-span-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Distribución por tramos</p>
                    {params.timeHorizonYears > 10 && (
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
                    )}
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

              <section className="-mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200 pt-5">
                <button
                  type="button"
                  onClick={() => handleToggleHousePurchase(!includeHousePurchase)}
                  className="flex items-center gap-2 w-full text-left font-['Signika',_sans-serif]"
                >
                  <span className="text-base font-bold text-gray-900 uppercase tracking-wider">
                    Incluir Compra de Casa 🏡
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-500 transition-transform ${includeHousePurchase ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </section>

              {includeHousePurchase && (
                <>
                  <FormSection title="Costes de la Casa" cols="double">
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
                    <HouseTypeField
                      isNewBuild={params.isNewBuild}
                      onChange={(v) => handleInputChange('isNewBuild', v)}
                    />
                    <InputField
                      label="Reforma y Muebles (€)"
                      value={params.reformCosts + params.furnitureCosts}
                      onChange={(v) => handleReformaMueblesChange(v)}
                    />
                    <article className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-200 flex flex-col justify-center">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Gastos Finales de la Casa</p>
                      <p className="text-xl font-bold text-gray-900">{formatCurrency(totalHouseExpenses)}</p>
                    </article>
                  </FormSection>

                  <FormSection title="Financiación" cols="triple">
                      <InputField
                      label="Cuota Hipoteca Mensual (€)"
                      value={params.monthlyMortgagePayment}
                      onChange={(v) => handleInputChange('monthlyMortgagePayment', v)}
                      disabled={params.baseCost === 0}
                      error={mortgageExceedsBase}
                      hint={params.baseCost === 0 ? 'Introduce un coste de casa para activar la hipoteca' : 'Al terminar de pagar la hipoteca, la cuota se redirige al ahorro mensual.'}
                    />
                    <InputField
                      label="TAE Hipoteca (%)"
                      value={params.mortgageAnnualRate}
                      onChange={(v) => handleInputChange('mortgageAnnualRate', v)}
                      step="0.1"
                      disabled={params.baseCost === 0}
                      hint={params.baseCost === 0 ? 'Introduce un coste de casa para activar la hipoteca' : undefined}
                    />
                    <InputField
                      label="Duración Hipoteca (años)"
                      value={params.mortgageDurationYears}
                      onChange={(v) => handleInputChange('mortgageDurationYears', v)}
                      disabled={params.baseCost === 0}
                      error={mortgageExceedsBase || undefined}
                      hint={params.baseCost === 0 ? 'Introduce un coste de casa para activar la hipoteca' : undefined}
                    />
                    <div className="flex flex-col gap-1.5">
                    <article className={`rounded-lg px-4 py-3 border flex flex-col justify-center ${params.baseCost === 0 ? 'bg-gray-100 border-gray-200' : 'bg-gray-50 border-gray-200'}`}>
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Préstamo Hipotecario Estimado</p>
                      <p className={`text-xl font-bold ${params.baseCost === 0 ? 'text-gray-400' : 'text-gray-900'}`}>{formatCurrency(mortgageGrantedAmount)}{params.baseCost > 0 && <span className="text-sm font-normal text-gray-500"> ({Math.round(mortgageGrantedAmount / params.baseCost * 100)}%)</span>}</p>
                    </article>
                    {params.baseCost === 0 && <p className="text-xs text-gray-400">Introduce un coste de casa para activar la hipoteca</p>}
                    </div>
                    <InputField
                      label="Préstamo Familiar (€)"
                      value={params.familyLoanAmount}
                      onChange={(v) => handleInputChange('familyLoanAmount', v)}
                      hint="0% interés · Al terminar de pagar el préstamo, la cuota se redirige al ahorro mensual."
                      error={undefined}
                    />
                    <InputField
                      label="Duración Préstamo (años)"
                      value={params.familyLoanDurationYears}
                      onChange={(v) => handleInputChange('familyLoanDurationYears', v)}
                    />
                  </FormSection>
                </>
              )}

              <FormSection title="Horizonte" cols="single">
                <InputField
                  label="Años a Simular"
                  value={params.timeHorizonYears}
                  onChange={(v) => handleInputChange('timeHorizonYears', v)}
                />
              </FormSection>

            </form>
          </section>

          {/* Results Section */}
          <main>
            {result && (
              <div className="space-y-6 mb-4">
                {/* Summary Section: details first, then results */}
                <section className="bg-white border border-gray-200 rounded-xl px-6 sm:px-8 pt-6 sm:pt-8 pb-0 shadow-sm overflow-hidden">

                  <section className="space-y-3 -mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200 pt-5 first:border-t-0 first:pt-0">
                    <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider mb-3">Datos del escenario</h3>

                    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                      <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Ahorro Inicial Invertible</p>
                        <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(result.initialAvailableForInvestment)}</p>
                      </article>
                      <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Aporte Mensual {monthlyHint && <InfoTip text={monthlyHint}>ℹ️</InfoTip>}</p>
                        <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(params.monthlyContribution)}</p>
                      </article>
                      {params.baseCost > 0 && (
                      <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Coste Casa</p>
                        <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(result.totalHouseExpenses)}</p>
                      </article>
                      )}
                      {(params.monthlyMortgagePayment > 0 || hasFamilyLoan) && (<>
                      {params.monthlyMortgagePayment > 0 ? (<>
                      <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Préstamo Hipotecario</p>
                        <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(result.mortgageGrantedAmount)}</p>
                      </article>
                      <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Cuota Hipoteca</p>
                        <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(params.monthlyMortgagePayment)}</p>
                      </article>
                      <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Duración Hipoteca</p>
                        <p className="text-base font-bold text-gray-900">{params.mortgageDurationYears} años</p>
                      </article>
                      </>) : (
                        <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Préstamo Hipotecario</p>
                          <p className="text-base font-bold text-gray-900">Inactivo</p>
                        </article>
                      )}
                      {hasFamilyLoan ? (<>
                        <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Cuota Préstamo Familiar</p>
                          <p className="text-base font-bold text-gray-900 break-words">{formatCurrency(familyLoanMonthlyPayment)}</p>
                        </article>
                        <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Duración Préstamo Familiar</p>
                          <p className="text-base font-bold text-gray-900">{params.familyLoanDurationYears} años</p>
                        </article>
                      </>) : (
                        <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Préstamo Familiar</p>
                          <p className="text-base font-bold text-gray-900">Inactivo</p>
                        </article>
                      )}
                      </>)}
                      <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Horizonte</p>
                        <p className="text-base font-bold text-gray-900">{params.timeHorizonYears} años</p>
                      </article>
                      {/*<article className="bg-red-50 rounded-lg px-3.5 py-3 border border-red-200">
                        <p className="text-xs font-medium text-red-600 uppercase tracking-wider mb-1">Impuestos Estimados</p>
                        <p className="text-base font-bold text-red-700">{formatCurrency(result.totalTaxesPaid)}</p>
                      </article>*/}
                    </div>
                  </section>

                  <section className="space-y-3 -mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200 pt-5 first:border-t-0 first:pt-0 mb-5">
                    <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider mb-3">Resultados</h3>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <ResultCard label="Total Ahorrado" value={formatCurrency(result.totalSavings)} icon="💰" />
                      <ResultCard label="Cuenta Remunerada" value={formatCurrency(result.finalSavingsAccount)} icon="🏦" />
                      <ResultCard label="Inversiones" value={formatCurrency(result.finalInvestments)} icon="📈" />
                    </div>
                  </section>

                {/* Breakdown Table */}
                  {(params.baseCost > 0 || params.monthlyContribution > 0 || params.initialSavingsAccount > 0 || params.initialInvestments > 0) && (
                  <section className="-mx-6 sm:-mx-8 border-t border-gray-200 first:border-t-0 first:pt-0">
                    <button
                      onClick={() => setShowDetail(!showDetail)}
                      className="py-5 w-full px-6 sm:px-8 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
                    >
                      <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider">Desglose Anual</h3>
                      <svg className={`cursor-pointer w-4 h-4 text-gray-600 transition-transform flex-shrink-0 ${showDetail ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </button>

                    {showDetail && (
                      <div className="px-6 sm:px-8 pt-5 pb-6 border-b border-gray-200">
                        <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-4">
                          Aportado vs Total
                        </p>
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
                      <>
                      <div className="relative">
                        <div className="overflow-x-auto overflow-y-auto max-h-[420px] overscroll-contain">
                          <table className="w-full min-w-full mb-3">
                            <thead>
                              <tr className="border-b border-gray-200 bg-gray-50">
                                <th className="px-6 sm:px-8 py-3 text-left text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Año</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Cuenta</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Inversiones</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Total</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">A cuenta</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">A inversiones</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Impuestos</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {result.monthlyBreakdown
                                .filter((m, i, arr) => m.month === 12 || i === arr.length - 1)
                                .map((entry) => (
                                  <tr key={`${entry.year}-${entry.month}`} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 sm:px-8 py-2.5 text-sm font-medium text-gray-900">{entry.year}º</td>
                                    <td className="px-6 sm:px-8 py-2.5 text-right text-sm text-gray-700">{formatCurrency(entry.savingsAccount)}</td>
                                    <td className="px-6 sm:px-8 py-2.5 text-right text-sm text-gray-700">{formatCurrency(entry.investments)}</td>
                                    <td className="px-6 sm:px-8 py-2.5 text-right text-sm font-semibold text-gray-900">{formatCurrency(entry.savingsAccount + entry.investments)}</td>
                                    <td className={`px-6 sm:px-8 py-2.5 text-right text-sm ${entry.yearlyToAccount < 0 ? 'text-red-600' : entry.yearlyToAccount > 0 ? 'text-gray-600' : 'text-gray-400'}`}>{entry.yearlyToAccount > 0 ? formatCurrency(entry.yearlyToAccount) : formatCurrency(0)}</td>
                                    <td className={`px-6 sm:px-8 py-2.5 text-right text-sm ${entry.yearlyToInvestment < 0 ? 'text-red-600' : entry.yearlyToInvestment > 0 ? 'text-gray-600' : 'text-gray-400'}`}>{entry.yearlyToInvestment > 0 ? formatCurrency(entry.yearlyToInvestment) : formatCurrency(0)}</td>
                                    <td className="px-6 sm:px-8 py-2.5 text-right text-sm text-red-600">{entry.yearlyGainsTaxPaid > 0 ? formatCurrency(entry.yearlyGainsTaxPaid) : '-'}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white from-50% to-transparent pointer-events-none" />
                      </div>
                      <div className="px-6 sm:px-8 py-3 bg-amber-50 border-t border-amber-200">
                        <p className="text-xs text-amber-800 leading-relaxed">
                          <strong>⚠️ Nota fiscal:</strong> Los beneficios tributan en la base del ahorro (19%–26%).
                          Los intereses de la cuenta remunerada ya están descontados anualmente.
                          Las plusvalías de inversiones solo tributan al vender, por lo que no se han descontado en la simulación al asumir <i>buy-and-hold</i>; 
                          si se vendieran al final del horizonte, se pagarían <strong>{formatCurrency(result.investmentSaleTax)}</strong> en impuestos,
                          con lo que el dinero total neto resultante de la simulación sería <strong>{formatCurrency(result.totalSavings - result.investmentSaleTax)}</strong>.
                        </p>
                      </div>
                      </>
                    )}
                  </section>
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
