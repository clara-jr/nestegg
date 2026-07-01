import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { calculateNetSalary, calculateTax, formatCurrency } from '../lib/calculations';
import {
  calculateAllRetirementAges,
  estimatePension,
  findRequiredSavings,
  generateDefaultPeriods,
  getDistributionPeriodIndex,
  getNetMonthlyContribution,
  getPeriodAgeRange,
  simulateDetailedPath,
  type RetirementParams,
  type RetirementAgeResult,
  type YearDetail,
} from '../lib/retirement';
import { getSimulatorData, subscribe, type SimulatorData } from '../lib/sharedStore';

interface InputFieldProps {
  label: string;
  value: number | string;
  onChange: (value: string) => void;
  type?: 'number' | 'text';
  step?: string;
  hint?: string;
  disabled?: boolean;
  error?: string;
}

function InputField({ label, value, onChange, type = 'number', step, hint, disabled, error }: Readonly<InputFieldProps>) {
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
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && hint && <p className={`text-xs ${disabled ? 'text-gray-300' : 'text-gray-500'}`}>{hint}</p>}
    </div>
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

type ViewMode = 'sin-pension' | 'con-pension';

export default function RetirementSimulator() {
  const [simData, setSimData] = useState<SimulatorData>(getSimulatorData);

  useEffect(() => {
    const unsub = subscribe(() => {
      setSimData(getSimulatorData());
    });
    return unsub;
  }, []);

  const pensionStartAge = 67;

  const [params, setParams] = useState<RetirementParams>(() => {
    const sd = getSimulatorData();
    const age = 32;
    const lifeExpectancy = 95;
    const hasMtg = sd.baseCost > 0;
    const hasLoan = sd.familyLoanAmount > 0 && sd.familyLoanDurationYears > 0;
    const famPay = hasLoan ? sd.familyLoanAmount / (sd.familyLoanDurationYears * 12) : 0;
    return {
      currentAge: age,
      currentSalary: 47000,
      yearsContributed: 10,
      monthlyExpensesPreResidency: Math.max(0, Math.round(calculateNetSalary(47000) / 12 - sd.monthlyContribution)),
      monthlyExpensesInResidency: 2500,
      residencyAge: 85,
      lifeExpectancy,
      pensionStartAge: 67,
      initialSavingsAccount: sd.initialSavingsAccount,
      initialInvestments: sd.initialInvestments,
      monthlyContribution: sd.monthlyContribution,
      savingsAccountRate: sd.savingsAccountRate,
      investmentRate: sd.investmentRate,
      monthlyMortgagePayment: hasMtg ? sd.monthlyMortgagePayment : 0,
      mortgageEndAge: hasMtg ? age + sd.mortgageDurationYears : 0,
      familyLoanMonthlyPayment: famPay,
      familyLoanEndAge: hasLoan ? age + sd.familyLoanDurationYears : 0,
      distributionPeriods: sd.distributionPeriods.length > 0
        ? (() => {
            const p = [...sd.distributionPeriods].reverse();
            const numP = Math.ceil(lifeExpectancy / 10);
            while (p.length < numP) p.push(50);
            for (let i = 0; i < Math.min(2, numP); i++) p[i] = 100;
            return p.slice(0, numP);
          })()
        : generateDefaultPeriods(lifeExpectancy),
      withdrawalPct: 10,
    };
  });

  const [results, setResults] = useState<RetirementAgeResult[]>([]);
  const [sameDistributionForAll, setSameDistributionForAll] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('con-pension');
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    const numPeriods = Math.ceil(params.lifeExpectancy / 10);
    setParams(prev => {
      if (prev.distributionPeriods.length === numPeriods) return prev;
      const updated = [...prev.distributionPeriods];
      while (updated.length < numPeriods) updated.push(50);
      const trimmed = updated.slice(0, numPeriods);
      for (let i = 0; i < Math.min(2, numPeriods); i++) trimmed[i] = 100;
      return { ...prev, distributionPeriods: trimmed };
    });
  }, [params.lifeExpectancy]);

  useEffect(() => {
    setParams(prev => {
      const sd = getSimulatorData();
      const hasMtg = sd.baseCost > 0;
      const hasLoan = sd.familyLoanAmount > 0 && sd.familyLoanDurationYears > 0;
      const famPay = hasLoan ? sd.familyLoanAmount / (sd.familyLoanDurationYears * 12) : 0;
      const newMortEnd = hasMtg ? prev.currentAge + sd.mortgageDurationYears : 0;
      const newFamEnd = hasLoan ? prev.currentAge + sd.familyLoanDurationYears : 0;
      const numPeriods = Math.ceil(prev.lifeExpectancy / 10);
      const sdPeriods = sd.distributionPeriods.length > 0
        ? [...sd.distributionPeriods].reverse()
        : prev.distributionPeriods;
      while (sdPeriods.length < numPeriods) sdPeriods.push(50);
      const trimmedPeriods = sdPeriods.slice(0, numPeriods);
      for (let i = 0; i < Math.min(2, numPeriods); i++) trimmedPeriods[i] = 100;
      if (
        prev.monthlyMortgagePayment === (hasMtg ? sd.monthlyMortgagePayment : 0)
        && prev.mortgageEndAge === newMortEnd
        && prev.familyLoanMonthlyPayment === famPay
        && prev.familyLoanEndAge === newFamEnd
        && prev.monthlyContribution === sd.monthlyContribution
        && prev.initialSavingsAccount === sd.initialSavingsAccount
        && prev.initialInvestments === sd.initialInvestments
        && prev.savingsAccountRate === sd.savingsAccountRate
        && prev.investmentRate === sd.investmentRate
        && JSON.stringify(prev.distributionPeriods) === JSON.stringify(trimmedPeriods)
      ) return prev;
      return {
        ...prev,
        initialSavingsAccount: sd.initialSavingsAccount,
        initialInvestments: sd.initialInvestments,
        monthlyContribution: sd.monthlyContribution,
        savingsAccountRate: sd.savingsAccountRate,
        investmentRate: sd.investmentRate,
        monthlyMortgagePayment: hasMtg ? sd.monthlyMortgagePayment : 0,
        mortgageEndAge: newMortEnd,
        familyLoanMonthlyPayment: famPay,
        familyLoanEndAge: newFamEnd,
        distributionPeriods: trimmedPeriods,
      };
    });
  }, [simData]);

  useEffect(() => {
    const derived = Math.max(0, Math.round(calculateNetSalary(params.currentSalary) / 12 - params.monthlyContribution));
    setParams(prev => {
      if (Math.abs(prev.monthlyExpensesPreResidency - derived) < 0.01) return prev;
      return { ...prev, monthlyExpensesPreResidency: derived };
    });
  }, [params.currentSalary, params.monthlyContribution]);

  const handleInputChange = (field: keyof RetirementParams, value: any) => {
    const numericValue = typeof value === 'string' ? Number.parseFloat(value) || 0 : value;
    setParams(prev => {
      const updated = { ...prev, [field]: numericValue };
      if (field === 'currentAge') {
        const sd = getSimulatorData();
        if (sd.baseCost > 0) updated.mortgageEndAge = numericValue + sd.mortgageDurationYears;
        if (sd.familyLoanAmount > 0 && sd.familyLoanDurationYears > 0) {
          updated.familyLoanEndAge = numericValue + sd.familyLoanDurationYears;
        }
      }
      return updated;
    });
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

  useEffect(() => {
    if (params.currentAge >= 1 && params.lifeExpectancy > params.currentAge) {
      const r = calculateAllRetirementAges(params);
      setResults(r);
    }
  }, [params.currentAge, params.lifeExpectancy, params.distributionPeriods]);

  const visiblePeriods = useMemo(() => {
    const horizonEndAge = params.currentAge + simData.timeHorizonYears;
    const minAge = Math.max(30, horizonEndAge);
    return params.distributionPeriods
      .map((pct, i) => {
        const range = getPeriodAgeRange(i, params.lifeExpectancy);
        return { ...range, pct, index: i };
      })
      .filter(p => p.endAge >= minAge)
      .map(p => ({
        ...p,
        startAge: p.startAge < minAge ? minAge : p.startAge,
      }));
  }, [params.distributionPeriods, params.lifeExpectancy, params.currentAge, simData.timeHorizonYears]);

  const earliestWithoutPension = useMemo(() => {
    const achievable = results.filter(r => r.achievableWithoutPension);
    return achievable.length > 0 ? achievable[0] : null;
  }, [results]);

  const earliestWithPension = useMemo(() => {
    const achievable = results.filter(r => r.achievableWithPension);
    return achievable.length > 0 ? achievable[0] : null;
  }, [results]);

  const selectedEarliest = viewMode === 'sin-pension' ? earliestWithoutPension : earliestWithPension;

  const detailedPath = useMemo<YearDetail[]>(() => {
    if (!selectedEarliest) return [];
    const monthlyPension = viewMode === 'con-pension'
      ? selectedEarliest.monthlyPension
      : 0;
    return simulateDetailedPath(params, selectedEarliest.retirementAge, monthlyPension);
  }, [params, selectedEarliest, viewMode]);

  const chartData = useMemo(() => {
    if (!selectedEarliest || detailedPath.length === 0) return [];
    return detailedPath
      .filter(d => d.age >= selectedEarliest.retirementAge)
      .map(d => ({
        age: d.age,
        total: Math.round(d.total),
      }));
  }, [detailedPath, selectedEarliest]);

  const evolvedResults = useMemo(() => {
    const earliestResult = selectedEarliest;
    if (!earliestResult) return [];

    const timeHorizonYears = getSimulatorData().timeHorizonYears;
    const startAge = Math.max(
      params.currentAge,
      Math.min(earliestResult.retirementAge - 5, params.currentAge + timeHorizonYears)
    );
    const endAge = params.lifeExpectancy;
    if (startAge >= endAge) return [];

    const monthlyAccountRate = params.savingsAccountRate / 12 / 100;
    const monthlyInvestmentRate = params.investmentRate / 12 / 100;
    const baseMonthlyPension = viewMode === 'con-pension' ? earliestResult.monthlyPension : 0;

    const resultByAge = new Map(results.map(r => [r.retirementAge, r]));

    const output: Array<{
      age: number;
      yearsContributed: number;
      monthlyPension: number;
      requiredSavings: number;
      cuenta: number;
      inversiones: number;
      total: number;
      aCuenta: number;
      aInversiones: number;
      impuestos: number;
      pensionUsada: number;
      esJubilacion: boolean;
      finHipoteca: boolean;
      finPrestamo: boolean;
      achievable: boolean;
    }> = [];

    // Simulate accumulation from currentAge up to startAge to get initial state
    let sa = params.initialSavingsAccount;
    let inv = params.initialInvestments;
    let costBasis = inv;
    let monthsElapsed = 0;
    let savingsGainsThisYear = 0;
    let previousSavingsGains = 0;
    let preContribSa = 0;
    let preContribInv = 0;
    let preTaxes = 0;
    const startMonths = (startAge - params.currentAge) * 12;

    for (let m = 1; m <= startMonths; m++) {
      const monthInYear = ((m - 1) % 12) + 1;
      const year = Math.ceil(m / 12);
      const ageDuringMonth = Math.floor((params.currentAge * 12 + m - 1) / 12);

      if (monthInYear === 1 && year > 1) {
        previousSavingsGains = savingsGainsThisYear;
        savingsGainsThisYear = 0;
        preContribSa = 0;
        preContribInv = 0;
        preTaxes = 0;
      }

      const accountInterest = sa * monthlyAccountRate;
      sa = sa * (1 + monthlyAccountRate);
      inv = inv * (1 + monthlyInvestmentRate);
      savingsGainsThisYear += accountInterest;

      const netContrib = getNetMonthlyContribution(
        ageDuringMonth,
        params.monthlyContribution,
        params.monthlyMortgagePayment,
        params.mortgageEndAge,
        params.familyLoanMonthlyPayment,
        params.familyLoanEndAge,
      );

      const periodIndex = getDistributionPeriodIndex(
        ageDuringMonth,
        params.lifeExpectancy,
        params.distributionPeriods.length,
      );
      const savingsPct = params.distributionPeriods[periodIndex] ?? 50;

      if (netContrib > 0) {
        const toSavings = netContrib * (savingsPct / 100);
        const toInv = netContrib * ((100 - savingsPct) / 100);
        sa += toSavings;
        inv += toInv;
        costBasis += toInv;
        preContribSa += toSavings;
        preContribInv += toInv;
      }

      if (monthInYear === 6 && year > 1 && previousSavingsGains > 0) {
        const tax = calculateTax(previousSavingsGains);
        sa -= tax;
        preTaxes += tax;
      }
    }

    monthsElapsed = startMonths;
    let prevYearGains = savingsGainsThisYear;

    // Iterate year by year from startAge to endAge
    let firstAchievableAge: number | null = null;
    for (let age = startAge; age <= endAge; age++) {
      const result = resultByAge.get(age);
      const savingsBeforeAge = Math.round((sa + inv) * 100) / 100;
      const isBeforeRetirement = age <= earliestResult.retirementAge;

      let yearAccountContrib = 0;
      let yearInvestmentContrib = 0;
      let yearTaxes = 0;
      let yearGains = 0;

      if (age > startAge) {
        for (let m = 0; m < 12; m++) {
          monthsElapsed++;
          const monthInYear = ((monthsElapsed - 1) % 12) + 1;
          const ageDuringMonth = Math.floor((params.currentAge * 12 + monthsElapsed - 1) / 12);

          const accountInterest = sa * monthlyAccountRate;
          sa = sa * (1 + monthlyAccountRate);
          inv = inv * (1 + monthlyInvestmentRate);
          yearGains += accountInterest;

          const periodIndex = getDistributionPeriodIndex(
            ageDuringMonth,
            params.lifeExpectancy,
            params.distributionPeriods.length,
          );
          const savingsPct = params.distributionPeriods[periodIndex] ?? 50;

          if (isBeforeRetirement) {
            const netContrib = getNetMonthlyContribution(
              ageDuringMonth,
              params.monthlyContribution,
              params.monthlyMortgagePayment,
              params.mortgageEndAge,
              params.familyLoanMonthlyPayment,
              params.familyLoanEndAge,
            );
            if (netContrib > 0) {
              const toSavings = netContrib * (savingsPct / 100);
              const toInvestments = netContrib * ((100 - savingsPct) / 100);
              sa += toSavings;
              inv += toInvestments;
              costBasis += toInvestments;
              yearAccountContrib += toSavings;
              yearInvestmentContrib += toInvestments;
            }
          } else {
            let monthlyExpenses = ageDuringMonth >= params.residencyAge
              ? params.monthlyExpensesInResidency
              : params.monthlyExpensesPreResidency;

            if (ageDuringMonth < params.mortgageEndAge && params.monthlyMortgagePayment > 0) {
              monthlyExpenses += params.monthlyMortgagePayment;
            }
            if (ageDuringMonth < params.familyLoanEndAge && params.familyLoanMonthlyPayment > 0) {
              monthlyExpenses += params.familyLoanMonthlyPayment;
            }

            const monthlyPension = ageDuringMonth >= params.pensionStartAge ? baseMonthlyPension : 0;
            const netFlow = monthlyPension - monthlyExpenses;

            if (netFlow >= 0) {
              const toSavings = netFlow * (savingsPct / 100);
              const toInvestments = netFlow * ((100 - savingsPct) / 100);
              sa += toSavings;
              inv += toInvestments;
              costBasis += toInvestments;
              yearAccountContrib += toSavings;
              yearInvestmentContrib += toInvestments;
            } else {
              let remaining = -netFlow;
              const usePct = params.withdrawalPct;

              let fromSavings = Math.min(remaining * usePct / 100, Math.max(0, sa));
              sa = Math.max(0, sa - fromSavings);
              remaining -= fromSavings;
              yearAccountContrib -= fromSavings;

              if (remaining > 0.01 && inv > 0.01) {
                const totalValue = inv;
                const costBasisRatio = Math.min(1, costBasis / totalValue);

                let sellAmount = remaining;
                for (let iter = 0; iter < 10; iter++) {
                  const gain = sellAmount * (1 - costBasisRatio);
                  const tax = calculateTax(Math.max(0, gain));
                  sellAmount = remaining + tax;
                }

                sellAmount = Math.min(sellAmount, totalValue);
                if (sellAmount > 0.01) {
                  const actualGain = sellAmount * (1 - costBasisRatio);
                  const tax = calculateTax(Math.max(0, actualGain));
                  const costBasisSold = sellAmount - actualGain;
                  costBasis = Math.max(0, costBasis - costBasisSold);
                  inv = Math.max(0, inv - sellAmount);
                  yearInvestmentContrib -= sellAmount;
                  yearTaxes += tax;
                  remaining = Math.max(0, remaining - (sellAmount - tax));
                }
              }

              if (remaining > 0.01) {
                const extra = Math.min(remaining, Math.max(0, sa));
                sa = Math.max(0, sa - extra);
                remaining -= extra;
                yearAccountContrib -= extra;
              }
            }
          }

          if (monthInYear === 6 && prevYearGains > 0 && sa > 0.01) {
            const tax = calculateTax(prevYearGains);
            const actualTax = Math.min(tax, Math.max(0, sa));
            sa = Math.max(0, sa - actualTax);
            yearTaxes += actualTax;
          }
        }
        prevYearGains = yearGains;
      }

      const requiredSavings = age === params.lifeExpectancy
        ? -1
        : result
          ? (viewMode === 'sin-pension' ? result.requiredSavingsWithoutPension : result.requiredSavingsWithPension)
          : viewMode === 'sin-pension'
            ? findRequiredSavings(age, 0, params, sa, inv, costBasis)
            : -1;

      const achievableNow = requiredSavings >= 0 && Math.round((sa + inv) * 100) / 100 >= requiredSavings;
      if (achievableNow && firstAchievableAge === null) {
        firstAchievableAge = age;
      }

      output.push({
        age,
        yearsContributed: result?.yearsContributedAtRetirement ?? (params.yearsContributed + Math.max(0, age - params.currentAge)),
        monthlyPension: resultByAge.get(age - 1)?.monthlyPension ?? estimatePension(params.currentSalary, params.currentAge, params.yearsContributed, age - 1),
        requiredSavings,
        cuenta: Math.round(sa * 100) / 100,
        inversiones: Math.round(inv * 100) / 100,
        total: Math.round((sa + inv) * 100) / 100,
        aCuenta: age === startAge ? Math.round(preContribSa * 100) / 100 : Math.round(yearAccountContrib * 100) / 100,
        aInversiones: age === startAge ? Math.round(preContribInv * 100) / 100 : Math.round(yearInvestmentContrib * 100) / 100,
        impuestos: age === startAge ? Math.round(preTaxes * 100) / 100 : Math.round(yearTaxes * 100) / 100,
        pensionUsada: age > params.pensionStartAge ? baseMonthlyPension : 0,
        esJubilacion: age === firstAchievableAge + 1,
        finHipoteca: age === params.mortgageEndAge + 1 && params.mortgageEndAge > 0,
        finPrestamo: age === params.familyLoanEndAge + 1 && params.familyLoanEndAge > 0,
        achievable: achievableNow,
      });
    }

    return output;
  }, [results, viewMode, params, selectedEarliest]);

  function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { age: number; total: number } }> }) {
    if (!active || !payload?.[0]) return null;
    const { age, total } = payload[0].payload;
    return (
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', fontFamily: 'Heebo, sans-serif' }}>
        <p style={{ fontWeight: 700, marginBottom: 4, color: '#111827' }}>{age} años</p>
        <p style={{ color: '#111827' }}>Total: {formatCurrency(total)}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-6 px-3 sm:px-4 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col items-center gap-4">
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mt-3">
              Calculadora de Jubilación
            </h1>
            <p className="text-sm text-gray-500 mt-3">
              Lleva el simulador de ahorros un paso más allá.
            </p>
            <p className="text-sm text-gray-500 mt-1 mb-2">Calcula cuándo jubilarte gestionando bien tus ahorros.</p>
          </div>
        </header>

        <div className="flex flex-col gap-6 md:gap-8">
          <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); setResults(calculateAllRetirementAges(params)); }}>
              <FormSection title="Datos Personales" cols="double">
                <InputField
                  label="Edad Actual"
                  value={params.currentAge}
                  onChange={(v) => handleInputChange('currentAge', v)}
                />
                <InputField
                  label="Salario Bruto Anual (€)"
                  value={params.currentSalary}
                  onChange={(v) => handleInputChange('currentSalary', v)}
                  error={params.currentSalary > 0 && calculateNetSalary(params.currentSalary) / 12 < params.monthlyContribution
                    ? `El salario neto mensual (${(calculateNetSalary(params.currentSalary) / 12).toFixed(0)} €) no cubre la aportación de ${params.monthlyContribution.toFixed(0)} €`
                    : undefined}
                />
                <InputField
                  label="Años Cotizados"
                  value={params.yearsContributed}
                  onChange={(v) => handleInputChange('yearsContributed', v)}
                  hint="Años que llevas cotizando a la Seguridad Social"
                />
                <InputField
                  label="Esperanza de Vida"
                  value={params.lifeExpectancy}
                  onChange={(v) => handleInputChange('lifeExpectancy', v)}
                />
              </FormSection>

              <FormSection title="Gastos en Jubilación" cols="double">
                <InputField
                  label="Gastos Mensuales en Residencia (€)"
                  value={params.monthlyExpensesInResidency}
                  onChange={(v) => handleInputChange('monthlyExpensesInResidency', v)}
                />
                <InputField
                  label="Edad de Residencia"
                  value={params.residencyAge}
                  onChange={(v) => handleInputChange('residencyAge', v)}
                />
                <div className="md:col-span-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Retiradas
                    </p>
                    <span className="text-xs font-semibold text-gray-700">
                      {params.withdrawalPct}% cuenta | {100 - params.withdrawalPct}% inversiones
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={params.withdrawalPct}
                    onChange={(e) => handleInputChange('withdrawalPct', Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-gray-700"
                  />
                  <p className="text-xs text-gray-500">De dónde sacar el dinero en etapas sin ingresos suficientes (desde la prejubilación hasta los {params.pensionStartAge} o {params.lifeExpectancy} años o en época de residencia)</p>
                  <p className="text-xs text-gray-500">Cuenta ← → Inversiones</p>
                </div>
              </FormSection>

              {(() => {
                const horizonEndAge = params.currentAge + simData.timeHorizonYears;
                const fullyDefined = horizonEndAge >= params.lifeExpectancy;
                return (
                  <FormSection title="Ahorros Mensuales" cols="single">
                    {fullyDefined ? (
                      <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
                        <p className="text-xs text-gray-800 leading-relaxed">
                          Los ahorros para la jubilación están completamente definidos en el simulador de ahorros.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
                          <p className="text-xs text-gray-500 leading-relaxed">
                            Los primeros {horizonEndAge - params.currentAge} años de ahorro siguen lo pautado en el simulador de ahorros. En esta calculadora se añaden los tramos desde los {horizonEndAge} años hasta la edad de jubilación.
                          </p>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                              Distribución por Tramos
                            </p>
                            {visiblePeriods.length > 1 && (
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
                          {(sameDistributionForAll ? [visiblePeriods[0]].filter(Boolean) : visiblePeriods).map((period) => {
                            const periodKey = sameDistributionForAll ? 'all' : `period-${period.startAge}-${period.endAge}`;
                            return (
                              <div key={periodKey} className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-medium text-gray-700">
                                    {sameDistributionForAll ? 'Todos los tramos' : `${period.startAge}–${period.endAge} años`}
                                  </p>
                                  <span className="text-xs font-semibold text-gray-700">
                                    {period.pct}% cuenta | {100 - period.pct}% inversiones
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={sameDistributionForAll ? (params.distributionPeriods[0] ?? 50) : period.pct}
                                  onChange={(e) => handleDistributionChange(period.index, Number(e.target.value))}
                                  className="w-full h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-gray-700"
                                />
                              </div>
                            );
                          })}
                          <p className="text-xs text-gray-500">Cuenta ← → Inversiones</p>
                        </div>
                      </>
                    )}
                  </FormSection>
                );
              })()}

              <div className="flex justify-center">
                <button
                  type="submit"
                  disabled={params.currentSalary > 0 && calculateNetSalary(params.currentSalary) / 12 < params.monthlyContribution}
                  className="cursor-pointer py-2.5 px-8 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all text-sm uppercase tracking-wider"
                >
                  Calcular Proyección
                </button>
              </div>
            </form>
          </section>

          <main>
            {results.length > 0 && (
              <div className="space-y-6 mb-4">
                <section className="bg-white border border-gray-200 rounded-xl px-6 sm:px-8 pt-6 sm:pt-8 pb-0 shadow-sm overflow-hidden">
                  {/* Datos del escenario */}
                  <section className="space-y-3 -mx-6 sm:-mx-8 px-6 sm:px-8 first:pt-0 pb-5">
                    <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider">Datos del escenario</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Ahorros Actuales</p>
                        <p className="text-xl font-bold text-gray-900">{formatCurrency(params.initialSavingsAccount + params.initialInvestments)}</p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Rentabilidades</p>
                        <p className="text-lg font-bold text-gray-900">
                          {params.savingsAccountRate}% cuenta · {params.investmentRate}% inversiones
                        </p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Esperanza de Vida</p>
                        <p className="text-lg font-bold text-gray-900">{params.lifeExpectancy} años</p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Hipoteca</p>
                        <p className="text-lg font-bold text-gray-900">
                          {params.monthlyMortgagePayment > 0 ? `${formatCurrency(params.monthlyMortgagePayment)}/mes` : 'Sin hipoteca'}
                        </p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Edad fin Hipoteca</p>
                        <p className="text-lg font-bold text-gray-900">
                          {params.mortgageEndAge > 0 ? `${params.mortgageEndAge} años` : '—'}
                        </p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Préstamo Familiar</p>
                        <p className="text-lg font-bold text-gray-900">
                          {params.familyLoanMonthlyPayment > 0 ? `${formatCurrency(params.familyLoanMonthlyPayment)}/mes` : 'Sin préstamo'}
                        </p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Edad fin Préstamo Familiar</p>
                        <p className="text-lg font-bold text-gray-900">
                          {params.familyLoanEndAge > 0 ? `${params.familyLoanEndAge} años` : '—'}
                        </p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Edad de Residencia</p>
                        <p className="text-lg font-bold text-gray-900">{params.residencyAge} años</p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Gastos en Residencia</p>
                        <p className="text-lg font-bold text-gray-900">{formatCurrency(params.monthlyExpensesInResidency)}/mes</p>
                      </article>
                    </div>
                  </section>

                  {/* Resumen de resultados */}
                  <section className="space-y-3 -mx-6 sm:-mx-8 px-6 sm:px-8 pt-5 pb-5 border-t border-gray-200">
                    <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider mb-3">Resumen de resultados</h3>
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Sin Pensión</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <ResultCard
                            label="Edad mínima de jubilación"
                            value={earliestWithoutPension ? `${earliestWithoutPension.retirementAge} años` : 'No alcanzable'}
                            icon="🧓"
                          />
                          <ResultCard
                            label={earliestWithoutPension ? `Ahorro necesario a los ${earliestWithoutPension.retirementAge} años` : 'Ahorro sin pensión'}
                            value={earliestWithoutPension ? formatCurrency(earliestWithoutPension.requiredSavingsWithoutPension) : '—'}
                            icon="💰"
                          />
                        </div>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Con Pensión{earliestWithPension ? ` (${formatCurrency(earliestWithPension.monthlyPension)}/mes a partir de los ${params.pensionStartAge} años)` : ''}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <ResultCard
                            label="Edad mínima de jubilación"
                            value={earliestWithPension ? `${earliestWithPension.retirementAge} años` : 'No alcanzable'}
                            icon="🧓"
                          />
                          <ResultCard
                            label={earliestWithPension ? `Ahorro necesario a los ${earliestWithPension.retirementAge} años` : 'Ahorro con pensión'}
                            value={earliestWithPension ? formatCurrency(earliestWithPension.requiredSavingsWithPension) : '—'}
                            icon="💰"
                          />
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Ahorro necesario según edad de jubilación */}
                  <section className="-mx-6 sm:-mx-8 border-t border-gray-200">
                    <button
                      onClick={() => setShowDetail(!showDetail)}
                      className="py-4 w-full px-6 sm:px-8 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
                    >
                      <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider">
                        Desglose Anual
                      </h3>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setViewMode('sin-pension')}
                            className={`cursor-pointer px-3 py-1.5 text-xs font-semibold rounded-md transition-all uppercase tracking-wider ${
                              viewMode === 'sin-pension'
                                ? 'bg-gray-900 text-white shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            Sin pensión
                          </button>
                          <button
                            onClick={() => setViewMode('con-pension')}
                            className={`cursor-pointer px-3 py-1.5 text-xs font-semibold rounded-md transition-all uppercase tracking-wider ${
                              viewMode === 'con-pension'
                                ? 'bg-gray-900 text-white shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            Con pensión
                          </button>
                        </div>
                        <svg className={`cursor-pointer w-4 h-4 text-gray-600 transition-transform flex-shrink-0 ${showDetail ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      </div>
                    </button>

                    {showDetail && chartData.length > 0 && selectedEarliest && (
                      <div className="px-6 sm:px-8 pt-5 pb-6 border-b border-gray-200">
                        <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-4">
                          Camino del ahorro desde los {selectedEarliest.retirementAge} años ({viewMode === 'con-pension' ? 'con pensión' : 'sin pensión'})
                        </p>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis
                              dataKey="age"
                              tick={{ fontSize: 12, fill: '#6b7280', fontFamily: 'Heebo, sans-serif' }}
                              tickFormatter={(v: number) => `${v} años`}
                              stroke="#d1d5db"
                              type="number"
                              domain={['dataMin', 'dataMax']}
                            />
                            <YAxis
                              tick={{ fontSize: 12, fill: '#6b7280', fontFamily: 'Heebo, sans-serif' }}
                              tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k €`}
                              stroke="#d1d5db"
                            />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend wrapperStyle={{ fontFamily: 'Heebo, sans-serif', fontSize: '12px' }} />
                            <Line type="monotone" dataKey="total" name="Total ahorrado" stroke="#111827" strokeWidth={2} dot={false} />
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
                                <th className="px-6 sm:px-8 py-3 text-left text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Edad</th>
                                {viewMode === 'con-pension' && (
                                  <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Pensión Est.</th>
                                )}
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Necesario</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Cuenta</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Inversiones</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Total</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">A cuenta</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">A inversiones</th>
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Impuestos</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {evolvedResults.map((r) => (
                                <tr
                                  key={r.age}
                                  className="hover:bg-gray-50 transition-colors"
                                >
                                  <td className="px-6 sm:px-8 py-2.5 text-sm text-gray-900">
                                    <span className="inline-flex items-center gap-1.5">
                                      {r.age - 1}-{r.age}
                                      {r.esJubilacion && (
                                        <span className="relative inline-flex items-center group">
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold cursor-help leading-none">J</span>
                                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-gray-800 text-white text-[10px] leading-tight whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
                                            Comienzo jubilación
                                          </span>
                                        </span>
                                      )}
                                      {viewMode === 'con-pension' && r.age === params.pensionStartAge + 1 && selectedEarliest && (
                                        <span className="relative inline-flex items-center group">
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold cursor-help leading-none">P</span>
                                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-gray-800 text-white text-[10px] leading-tight whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
                                            Pensión: {formatCurrency(selectedEarliest.monthlyPension)}/mes
                                          </span>
                                        </span>
                                      )}
                                      {r.finHipoteca && (
                                        <span className="relative inline-flex items-center group">
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-sky-100 text-sky-700 text-[9px] font-bold cursor-help leading-none">H</span>
                                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-gray-800 text-white text-[10px] leading-tight whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
                                            Hipoteca pagada
                                          </span>
                                        </span>
                                      )}
                                      {r.finPrestamo && (
                                        <span className="relative inline-flex items-center group">
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-purple-100 text-purple-700 text-[9px] font-bold cursor-help leading-none">F</span>
                                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-gray-800 text-white text-[10px] leading-tight whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
                                            Préstamo familiar pagado
                                          </span>
                                        </span>
                                      )}
                                    </span>
                                  </td>
                                  {viewMode === 'con-pension' && (
                                    <td className="px-6 sm:px-8 py-2.5 text-right text-sm text-gray-700">{formatCurrency(r.monthlyPension)}</td>
                                  )}
                                  <td className={`px-6 sm:px-8 py-2.5 text-right text-sm ${r.requiredSavings < 0 || (viewMode === 'con-pension' && r.age >= params.pensionStartAge + 1) ? 'text-gray-400' : r.achievable ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {r.requiredSavings > 0 && !(viewMode === 'con-pension' && r.age >= params.pensionStartAge + 1)
                                      ? formatCurrency(r.requiredSavings)
                                      : r.age === params.lifeExpectancy
                                        ? <span className="relative inline-flex items-center group cursor-help">—<span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-gray-800 text-white text-[10px] leading-tight whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">Los ahorros necesarios a los {params.lifeExpectancy} años son nulos porque aquí termina la esperanza de vida</span></span>
                                        : '—'}
                                  </td>
                                  <td className="px-6 sm:px-8 py-2.5 text-right text-sm text-gray-700">
                                    {formatCurrency(r.cuenta)}
                                  </td>
                                  <td className="px-6 sm:px-8 py-2.5 text-right text-sm text-gray-700">
                                    {formatCurrency(r.inversiones)}
                                  </td>
                                  <td className="px-6 sm:px-8 py-2.5 text-right text-sm font-semibold text-gray-900">
                                    {formatCurrency(r.total)}
                                  </td>
                                  <td className={`px-6 sm:px-8 py-2.5 text-right text-sm ${r.aCuenta < 0 ? 'text-red-600' : r.aCuenta > 0 ? 'text-gray-600' : 'text-gray-400'}`}>
                                    {formatCurrency(r.aCuenta)}
                                  </td>
                                  <td className={`px-6 sm:px-8 py-2.5 text-right text-sm ${r.aInversiones < 0 ? 'text-red-600' : r.aInversiones > 0 ? 'text-gray-600' : 'text-gray-400'}`}>
                                    {formatCurrency(r.aInversiones)}
                                  </td>
                                  <td className="px-6 sm:px-8 py-2.5 text-right text-sm text-red-600">
                                    {r.impuestos > 0 ? formatCurrency(r.impuestos) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white from-50% to-transparent pointer-events-none" />
                      </div>
                      <div className="px-6 sm:px-8 py-3 bg-blue-50 border-t border-blue-200">
                        <p className="text-xs text-blue-800 leading-relaxed">
                          ℹ️ La columna <strong>Necesario</strong> indica el ahorro necesario al <strong>final</strong> de ese año para poder jubilarse. La columna <strong>Total</strong> refleja el ahorro total al <strong>final</strong> del año, tras las aportaciones, inversiones o retiradas realizadas durante el mismo.
                          Si el <strong>Total</strong> supera lo <strong>Necesario</strong>, significa que se puede comenzar la jubilación al completar ese año.
                        </p>
                      </div>
                      <div className="px-6 sm:px-8 py-3 bg-amber-50 border-t border-amber-200">
                        <p className="text-xs text-amber-800 leading-relaxed">
                          <strong>⚠️ Nota fiscal:</strong> Los beneficios tributan en la base del ahorro (19%–26%).
                          Los intereses de la cuenta remunerada ya están descontados anualmente.
                          Las plusvalías de las inversiones solo tributan al vender; en la columna <strong>Impuestos</strong> se reflejan tanto el impuesto anual sobre intereses como el impuesto sobre plusvalías al retirar durante la jubilación.
                        </p>
                      </div>
                      </>
                    )}
                  </section>

                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
