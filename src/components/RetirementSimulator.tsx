import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { calculateNetSalary, calculateTax, formatCurrency } from '../lib/calculations';
import {
  buildPensionSchedule,
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
  type MemberConfig,
} from '../lib/retirement';
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

interface FormSectionProps {
  title: string;
  children: React.ReactNode;
  cols?: 'single' | 'double';
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
  const defaultMember: MemberConfig = {
    currentAge: 30,
    currentSalary: 0,
    yearsContributed: 10,
  };

  const [params, setParams] = useLocalStorage<RetirementParams>('retirement-params', () => {
    const lifeExpectancy = 95;
    return {
      members: [defaultMember],
      monthlyExpensesPreResidency: 0,
      monthlyExpensesInResidency: 0,
      residencyAge: 85,
      lifeExpectancy,
      initialSavingsAccount: 0,
      initialInvestments: 0,
      monthlyContribution: 0,
      savingsAccountRate: 2,
      investmentRate: 7,
      monthlyMortgagePayment: 0,
      mortgageEndAge: 0,
      mortgageDurationYears: 0,
      familyLoanMonthlyPayment: 0,
      familyLoanEndAge: 0,
      familyLoanDurationYears: 0,
      distributionPeriods: generateDefaultPeriods(lifeExpectancy),
      withdrawalPct: 10,
    };
  });

  const [sameDistributionForAll, setSameDistributionForAll] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('con-pension');
  const [showDetail, setShowDetail] = useState(false);

  // Migrate stored params if they lack new fields
  useEffect(() => {
    setParams(prev => {
      let changed = false;
      const next = { ...prev };
      if (next.mortgageDurationYears === undefined) { next.mortgageDurationYears = 0; changed = true; }
      if (next.familyLoanDurationYears === undefined) { next.familyLoanDurationYears = 0; changed = true; }
      return changed ? next : prev;
    });
  }, []);

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
    const totalNetSalary = params.members.reduce((sum, m) => sum + calculateNetSalary(m.currentSalary), 0);
    const totalDebt = params.monthlyMortgagePayment + params.familyLoanMonthlyPayment;
    const derived = Math.max(0, Math.round(totalNetSalary / 12 - params.monthlyContribution - totalDebt));
    setParams(prev => {
      if (Math.abs(prev.monthlyExpensesPreResidency - derived) < 0.01) return prev;
      return { ...prev, monthlyExpensesPreResidency: derived };
    });
  }, [params.members, params.monthlyContribution, params.monthlyMortgagePayment, params.familyLoanMonthlyPayment]);

  useEffect(() => {
    const refAge = params.members[0].currentAge;
    setParams(prev => {
      const newEndAge = prev.mortgageDurationYears > 0 ? refAge + prev.mortgageDurationYears : 0;
      const newLoanEndAge = prev.familyLoanDurationYears > 0 ? refAge + prev.familyLoanDurationYears : 0;
      if (prev.mortgageEndAge === newEndAge && prev.familyLoanEndAge === newLoanEndAge) return prev;
      return { ...prev, mortgageEndAge: newEndAge, familyLoanEndAge: newLoanEndAge };
    });
  }, [params.members, params.mortgageDurationYears, params.familyLoanDurationYears]);

  // Sync members and salaries to shared store
  useEffect(() => {
    const salaries = params.members.map(m => m.currentSalary);
    setSimulatorData({ memberSalaries: salaries });
  }, [params.members]);

  // Sync initial savings and monthly params from Savings Simulator
  useEffect(() => {
    const unsub = subscribe(() => {
      const sd = getSimulatorData();
      setParams(prev => {
        const refAge = prev.members[0].currentAge;
        const updates: Partial<RetirementParams> = {};
        if (prev.initialSavingsAccount !== sd.initialSavingsAccount) updates.initialSavingsAccount = sd.initialSavingsAccount;
        if (prev.initialInvestments !== sd.initialInvestments) updates.initialInvestments = sd.initialInvestments;
        if (prev.monthlyContribution !== sd.monthlyContribution) updates.monthlyContribution = sd.monthlyContribution;
        if (prev.monthlyMortgagePayment !== sd.monthlyMortgagePayment) updates.monthlyMortgagePayment = sd.monthlyMortgagePayment;
        if (prev.mortgageDurationYears !== sd.mortgageDurationYears) updates.mortgageDurationYears = sd.mortgageDurationYears;
        if (prev.familyLoanMonthlyPayment !== sd.familyLoanMonthlyPayment) updates.familyLoanMonthlyPayment = sd.familyLoanMonthlyPayment;
        if (prev.familyLoanDurationYears !== sd.familyLoanDurationYears) updates.familyLoanDurationYears = sd.familyLoanDurationYears;
        if (sd.memberSalaries.length > 0) {
          const hasDiff = sd.memberSalaries.some(
            (s, i) => s !== (prev.members[i]?.currentSalary ?? -1)
          ) || sd.memberSalaries.length !== prev.members.length;
          if (hasDiff) {
            const ref = prev.members[0];
            updates.members = sd.memberSalaries.map(s => ({
              currentAge: ref.currentAge,
              currentSalary: s,
              yearsContributed: ref.yearsContributed,
            }));
          }
        }
        if (Object.keys(updates).length === 0) return prev;
        return { ...prev, ...updates };
      });
    });
    return unsub;
  }, []);

  const handleInputChange = (field: keyof RetirementParams, value: any) => {
    const numericValue = typeof value === 'string' ? Number.parseFloat(value) || 0 : value;
    setParams(prev => {
      const updated = { ...prev, [field]: numericValue };
      return updated;
    });
  };

  const handleMemberChange = (index: number, field: keyof MemberConfig, value: any) => {
    const numericValue = typeof value === 'string' ? Number.parseFloat(value) || 0 : value;
    setParams(prev => {
      const members = [...prev.members];
      members[index] = { ...members[index], [field]: numericValue };
      return { ...prev, members };
    });
  };

  const addMember = () => {
    const ref = params.members[0];
    setParams(prev => ({
      ...prev,
      members: [...prev.members, { ...ref }],
    }));
  };

  const removeMember = (index: number) => {
    if (params.members.length <= 1) return;
    setParams(prev => ({
      ...prev,
      members: prev.members.filter((_, i) => i !== index),
    }));
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

  const results = useMemo(() => {
    const refAge = params.members[0].currentAge;
    if (refAge >= 1 && params.lifeExpectancy > refAge) {
      return calculateAllRetirementAges(params);
    }
    return [] as RetirementAgeResult[];
  }, [params.members, params.lifeExpectancy, params.distributionPeriods, params.monthlyContribution, params.initialSavingsAccount, params.initialInvestments, params.savingsAccountRate, params.investmentRate, params.monthlyExpensesPreResidency, params.monthlyExpensesInResidency, params.residencyAge, params.monthlyMortgagePayment, params.mortgageEndAge, params.familyLoanMonthlyPayment, params.familyLoanEndAge, params.withdrawalPct]);

  const visiblePeriods = useMemo(() => {
    const refAge = params.members[0].currentAge;
    return params.distributionPeriods
      .map((pct, i) => {
        const range = getPeriodAgeRange(i, params.lifeExpectancy);
        if (range.endAge < refAge) return null;
        return {
          ...range,
          startAge: Math.max(refAge, range.startAge),
          pct,
          index: i,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [params.distributionPeriods, params.lifeExpectancy, params.members]);

  const earliestWithoutPension = useMemo(() => {
    const achievable = results.filter(r => r.achievableWithoutPension);
    return achievable.length > 0 ? achievable[0] : null;
  }, [results]);

  const earliestWithPension = useMemo(() => {
    const achievable = results.filter(r => r.achievableWithPension);
    return achievable.length > 0 ? achievable[0] : null;
  }, [results]);

  const selectedEarliest = viewMode === 'sin-pension' ? earliestWithoutPension : earliestWithPension;

  const isSinPensionAchievable = earliestWithoutPension !== null;
  const isConPensionAchievable = earliestWithPension !== null;
  const showDesglose = isSinPensionAchievable || isConPensionAchievable;
  const bothAchievable = isSinPensionAchievable && isConPensionAchievable;

  useEffect(() => {
    if (!isSinPensionAchievable && viewMode !== 'con-pension') {
      setViewMode('con-pension');
    } else if (!isConPensionAchievable && viewMode !== 'sin-pension') {
      setViewMode('sin-pension');
    }
  }, [isSinPensionAchievable, isConPensionAchievable]);

  const detailedPath = useMemo<YearDetail[]>(() => {
    if (!selectedEarliest) return [];
    const pensions = viewMode === 'con-pension'
      ? buildPensionSchedule(params.members, selectedEarliest.retirementAge)
      : [];
    return simulateDetailedPath(params, selectedEarliest.retirementAge, pensions);
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
    const refMember = params.members[0];

    const startAge = refMember.currentAge;
    const endAge = params.lifeExpectancy;
    if (startAge >= endAge) return [];

    const monthlyAccountRate = params.savingsAccountRate / 12 / 100;
    const monthlyInvestmentRate = params.investmentRate / 12 / 100;
    const pensions = viewMode === 'con-pension'
      ? buildPensionSchedule(params.members, earliestResult.retirementAge)
      : [];
    const currentPensionsForAge = (age: number) => {
      const yearsSinceRetirement = age - earliestResult.retirementAge;
      return pensions
        .filter(p => yearsSinceRetirement >= p.startOffset)
        .reduce((sum, p) => sum + p.monthlyAmount, 0);
    };
    const memberAgesAtAge = (age: number) => params.members.map(m => m.currentAge + (age - refMember.currentAge));

    const resultByAge = new Map(results.map(r => [r.retirementAge, r]));

    const output: Array<{
      age: number;
      memberAges: number[];
      monthlyPension: number;
      requiredSavings: number;
      cuenta: number;
      inversiones: number;
      total: number;
      aCuenta: number;
      aInversiones: number;
      impuestos: number;
      pensionUsada: number;
      gastosMensuales: number;
      esJubilacion: boolean;
      finHipoteca: boolean;
      finPrestamo: boolean;
      achievable: boolean;
    }> = [];

    // Simulate accumulation from currentAge up to startAge
    let sa = params.initialSavingsAccount;
    let inv = params.initialInvestments;
    let costBasis = inv;
    let monthsElapsed = 0;
    let savingsGainsThisYear = 0;
    let previousSavingsGains = 0;
    let preContribSa = 0;
    let preContribInv = 0;
    let preTaxes = 0;
    const startMonths = (startAge - refMember.currentAge) * 12;

    for (let m = 1; m <= startMonths; m++) {
      const monthInYear = ((m - 1) % 12) + 1;
      const year = Math.ceil(m / 12);
      const ageDuringMonth = Math.floor((refMember.currentAge * 12 + m - 1) / 12);

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

    let firstAchievableAge: number | null = null;
    for (let age = startAge + 1; age <= endAge; age++) {
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
          const ageDuringMonth = Math.floor((refMember.currentAge * 12 + monthsElapsed - 1) / 12);

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
            const numM = params.members.length;
            const refCA = params.members[0].currentAge;
            let monthlyExpenses = params.members.reduce((sum, m) => {
              const ma = m.currentAge + (ageDuringMonth - refCA);
              return sum + (ma >= params.residencyAge
                ? params.monthlyExpensesInResidency / numM
                : params.monthlyExpensesPreResidency / numM);
            }, 0);
            monthlyExpenses = Math.round(monthlyExpenses * 100) / 100;

            if (ageDuringMonth < params.mortgageEndAge && params.monthlyMortgagePayment > 0) {
              monthlyExpenses += params.monthlyMortgagePayment;
            }
            if (ageDuringMonth < params.familyLoanEndAge && params.familyLoanMonthlyPayment > 0) {
              monthlyExpenses += params.familyLoanMonthlyPayment;
            }

            const totalPension = currentPensionsForAge(ageDuringMonth);
            const netFlow = totalPension - monthlyExpenses;

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
            ? findRequiredSavings(age, [], params, sa, inv, costBasis)
            : -1;

      const achievableNow = requiredSavings >= 0 && Math.round((sa + inv) * 100) / 100 >= requiredSavings;
      if (achievableNow && firstAchievableAge === null) {
        firstAchievableAge = age;
      }

      const numM = params.members.length;
      const refCA = params.members[0].currentAge;
      const rawExpenses = params.members.reduce((sum, m) => {
        const ma = m.currentAge + (age - refCA);
        return sum + (ma >= params.residencyAge
          ? params.monthlyExpensesInResidency / numM
          : params.monthlyExpensesPreResidency / numM);
      }, 0);
      let gastosMensuales = Math.round(rawExpenses * 100) / 100;
      if (age < params.mortgageEndAge && params.monthlyMortgagePayment > 0) {
        gastosMensuales += params.monthlyMortgagePayment;
      }
      if (age < params.familyLoanEndAge && params.familyLoanMonthlyPayment > 0) {
        gastosMensuales += params.familyLoanMonthlyPayment;
      }

      output.push({
        age,
        memberAges: memberAgesAtAge(age),
        monthlyPension: result ? result.memberPensions.reduce((a, b) => a + b, 0) : results.length > 0 ? results[results.length - 1].memberPensions.reduce((a, b) => a + b, 0) : 0,
        requiredSavings,
        cuenta: Math.round(sa * 100) / 100,
        inversiones: Math.round(inv * 100) / 100,
        total: Math.round((sa + inv) * 100) / 100,
        aCuenta: age === startAge ? Math.round(preContribSa * 100) / 100 : Math.round(yearAccountContrib * 100) / 100,
        aInversiones: age === startAge ? Math.round(preContribInv * 100) / 100 : Math.round(yearInvestmentContrib * 100) / 100,
        impuestos: age === startAge ? Math.round(preTaxes * 100) / 100 : Math.round(yearTaxes * 100) / 100,
        pensionUsada: viewMode === 'con-pension' ? currentPensionsForAge(age) : 0,
        gastosMensuales,
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

  const totalNet = params.members.reduce((sum, m) => sum + calculateNetSalary(m.currentSalary), 0);
  const totalCommitment = params.monthlyContribution + params.monthlyMortgagePayment + params.familyLoanMonthlyPayment;
  const salaryError = params.monthlyContribution > 0 && totalNet / 12 < totalCommitment
    ? `El salario neto mensual conjunto (${Math.round(totalNet / 12)} €) no cubre aportación + hipoteca + préstamo (${Math.round(totalCommitment)} €)`
    : '';
  return (
    <div className="min-h-screen py-6 px-3 sm:px-4 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-6 md:gap-8">
          <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); }}>
              <FormSection title="Datos Personales" cols="single">
                <div className="space-y-4">
                  {params.members.map((member, i) => (
                    <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                      {params.members.length > 1 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                          Integrante {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeMember(i)}
                          className="text-red-600 hover:text-red-800 cursor-pointer"
                          title="Eliminar integrante"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                          </svg>
                        </button>
                      </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <InputField
                          label="Edad Actual"
                          value={member.currentAge}
                          onChange={(v) => handleMemberChange(i, 'currentAge', v)}
                        />
                        <InputField
                          label="Salario Bruto Anual (€)"
                          value={member.currentSalary}
                          onChange={(v) => handleMemberChange(i, 'currentSalary', v)}
                          hint="Con este dato y el aporte mensual se deducen los gastos fijos mensuales"
                        />
                        <InputField
                          label="Años Cotizados"
                          value={member.yearsContributed}
                          onChange={(v) => handleMemberChange(i, 'yearsContributed', v)}
                          hint="Años cotizando a la Seguridad Social"
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addMember}
                    className="cursor-pointer w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm font-semibold text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-all"
                  >
                    + Añadir integrante
                  </button>
                </div>
                <InputField
                  label="Esperanza de Vida"
                  value={params.lifeExpectancy}
                  onChange={(v) => handleInputChange('lifeExpectancy', v)}
                  error={params.residencyAge > params.lifeExpectancy ? 'La edad de residencia no puede ser mayor que la esperanza de vida' : undefined}
                />
              </FormSection>

              <FormSection title="Ahorros Iniciales" cols="double">
                <InputField
                  label="Cuenta Remunerada Inicial (€)"
                  value={params.initialSavingsAccount}
                  onChange={(v) => handleInputChange('initialSavingsAccount', v)}
                />
                <InputField
                  label="Inversiones Iniciales (€)"
                  value={params.initialInvestments}
                  onChange={(v) => handleInputChange('initialInvestments', v)}
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
              </FormSection>

              <FormSection title="Ahorros Mensuales" cols="single">
                <InputField
                  label="Aporte Total Mensual (€)"
                  value={params.monthlyContribution}
                  onChange={(v) => handleInputChange('monthlyContribution', v)}
                  hint="Importe destinado íntegramente a cuenta remunerada e inversiones."
                />
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
              </FormSection>

              <FormSection title="Hipoteca y Préstamo" cols="double">
                <InputField
                  label="Cuota Hipoteca Mensual (€)"
                  value={params.monthlyMortgagePayment}
                  onChange={(v) => handleInputChange('monthlyMortgagePayment', v)}
                  hint="Al terminar de pagar la hipoteca, la cuota se redirige al ahorro mensual."
                />
                <InputField
                  label="Duración Hipoteca (años)"
                  value={params.mortgageDurationYears}
                  onChange={(v) => handleInputChange('mortgageDurationYears', v)}
                  hint={params.mortgageDurationYears > 0 && params.members.length > 0 ? `Finaliza a los ${params.members[0].currentAge + params.mortgageDurationYears} años${params.members.length > 1 ? ' del integrante nº 1' : ''}.` : undefined}
                />
                <InputField
                  label="Préstamo Familiar Mensual (€)"
                  value={params.familyLoanMonthlyPayment}
                  onChange={(v) => handleInputChange('familyLoanMonthlyPayment', v)}
                  hint="0% interés · Al terminar de pagar el préstamo, la cuota se redirige al ahorro mensual."
                />
                <InputField
                  label="Duración Préstamo (años)"
                  value={params.familyLoanDurationYears}
                  onChange={(v) => handleInputChange('familyLoanDurationYears', v)}
                  hint={params.familyLoanDurationYears > 0 && params.members.length > 0 ? `Finaliza a los ${params.members[0].currentAge + params.familyLoanDurationYears} años${params.members.length > 1 ? ' del integrante nº 1' : ''}.` : undefined}
                />
              </FormSection>

              <FormSection title="Gastos en Jubilación" cols="double">
                <InputField
                  label="Gastos Mensuales en Residencia (€)"
                  value={params.monthlyExpensesInResidency}
                  onChange={(v) => handleInputChange('monthlyExpensesInResidency', v)}
                  hint={"Gastos totales incluyendo a todos los integrantes"}
                />
                <InputField
                  label="Edad de Residencia"
                  value={params.residencyAge}
                  onChange={(v) => handleInputChange('residencyAge', v)}
                  error={params.residencyAge > params.lifeExpectancy ? 'La edad de residencia no puede ser mayor que la esperanza de vida' : undefined}
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
                  <p className="text-xs text-gray-500">De dónde rescatar el dinero en etapas de ingresos insuficientes (p.ej. mientras no se percibe pensión o en época de residencia)</p>
                  <p className="text-xs text-gray-500">Cuenta ← → Inversiones</p>
                </div>
              </FormSection>

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
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 inline-flex items-center gap-1">
                          Ahorros Actuales
                        </p>
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
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 inline-flex items-center gap-1">
                          Gastos Fijos Mensuales
                          <InfoTip text={`${formatCurrency(Math.round(totalNet / 12))}/mes salario neto − ${formatCurrency(params.monthlyContribution)}/mes aportación − ${formatCurrency(params.monthlyMortgagePayment + params.familyLoanMonthlyPayment)}/mes deuda = ${formatCurrency(params.monthlyExpensesPreResidency)}/mes`}>ℹ️</InfoTip>
                        </p>
                        <p className="text-lg font-bold text-gray-900">{formatCurrency(params.monthlyExpensesPreResidency)}/mes</p>
                      </article>
                      {(params.monthlyMortgagePayment > 0 || params.familyLoanMonthlyPayment > 0) && (<>
                      {params.monthlyMortgagePayment > 0 ? (<>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Hipoteca</p>
                        <p className="text-lg font-bold text-gray-900">{formatCurrency(params.monthlyMortgagePayment)}/mes</p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Edad fin Hipoteca</p>
                        <p className="text-lg font-bold text-gray-900">{params.mortgageEndAge} años</p>
                      </article>
                      </>) : (
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Hipoteca</p>
                        <p className="text-lg font-bold text-gray-900">Inactiva</p>
                      </article>
                      )}
                      {params.familyLoanMonthlyPayment > 0 ? (<>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Préstamo Familiar</p>
                        <p className="text-lg font-bold text-gray-900">{formatCurrency(params.familyLoanMonthlyPayment)}/mes</p>
                      </article>
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Edad fin Préstamo Familiar</p>
                        <p className="text-lg font-bold text-gray-900">{params.familyLoanEndAge} años</p>
                      </article>
                      </>) : (
                      <article className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-col justify-center">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Préstamo Familiar</p>
                        <p className="text-lg font-bold text-gray-900">Inactivo</p>
                      </article>
                      )}
                      </>)}
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
                    <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider mb-3">Resultados</h3>
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Sin Pensión</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <ResultCard
                            label="Edad mínima de jubilación"
                            value={params.members.every(m => m.currentSalary === 0) ? '-' : (earliestWithoutPension ? `${earliestWithoutPension.retirementAge} años` : 'No alcanzable')}
                            icon="🧓"
                          />
                          {params.members.some(m => m.currentSalary > 0) && (
                          <ResultCard
                            label={earliestWithoutPension ? `Ahorro necesario a los ${earliestWithoutPension.retirementAge} años` : 'Ahorro sin pensión'}
                            value={earliestWithoutPension ? formatCurrency(earliestWithoutPension.requiredSavingsWithoutPension) : '—'}
                            icon="💰"
                          />
                          )}
                        </div>
                        {earliestWithoutPension && params.members.length > 1 && (
                          <div className="mt-2 text-xs text-gray-600">
                            <p>Edades al jubilarse: {earliestWithoutPension.memberAges.map((age, i) => `M${i + 1}: ${age} años`).join(', ')}</p>
                          </div>
                        )}
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Con Pensión
                          {earliestWithPension && ` (${formatCurrency(earliestWithPension.memberPensions.reduce((a, b) => a + b, 0))}/mes${params.members.length > 1 ? ' total' : ''})`}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <ResultCard
                            label="Edad mínima de jubilación"
                            value={params.members.every(m => m.currentSalary === 0) ? '-' : (earliestWithPension ? `${earliestWithPension.retirementAge} años` : 'No alcanzable')}
                            icon="🧓"
                          />
                          {params.members.some(m => m.currentSalary > 0) && (
                          <ResultCard
                            label={earliestWithPension ? `Ahorro necesario a los ${earliestWithPension.retirementAge} años` : 'Ahorro con pensión'}
                            value={earliestWithPension ? formatCurrency(earliestWithPension.requiredSavingsWithPension) : '—'}
                            icon="💰"
                          />
                          )}
                        </div>
                        {earliestWithPension && params.members.length > 1 && (
                          <div className="mt-2 text-xs text-gray-600 space-y-1">
                            <p>Edades al jubilarse: {earliestWithPension.memberAges.map((age, i) => `M${i + 1}: ${age} años`).join(', ')}</p>
                            <p>Pensiones: {earliestWithPension.memberPensions.map((p, i) => `M${i + 1}: ${formatCurrency(p)}/mes`).join(', ')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* Ahorro necesario según edad de jubilación */}
                  {showDesglose && params.members.some(m => m.currentSalary > 0) && (
                  <section className="-mx-6 sm:-mx-8 border-t border-gray-200">
                    <button
                      onClick={() => setShowDetail(!showDetail)}
                      className="py-4 w-full px-6 sm:px-8 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
                    >
                      <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider">
                        Desglose Anual
                      </h3>
                      <div className="flex items-center gap-3">
                        {bothAchievable ? (
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
                        ) : (
                          <span className="px-3 py-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                            {viewMode === 'con-pension' ? 'Con pensión' : 'Sin pensión'}
                          </span>
                        )}
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
                                <th className="px-6 sm:px-8 py-3 text-right text-xs font-bold text-gray-900 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">Gastos</th>
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
                                        <InfoTip text="Comienzo jubilación">
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold leading-none">J</span>
                                        </InfoTip>
                                      )}
                                      {viewMode === 'con-pension' && selectedEarliest && params.members.length === 1 && r.pensionUsada > 0 && r.age > 0 && (() => { const idx = evolvedResults.indexOf(r); return idx >= 2 && evolvedResults[idx - 2].pensionUsada === 0 && evolvedResults[idx - 1].pensionUsada > 0; })() && (
                                        <InfoTip text={`Pensión: ${formatCurrency(r.monthlyPension)}/mes`}>
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold leading-none">P</span>
                                        </InfoTip>
                                      )}
                                      {viewMode === 'con-pension' && selectedEarliest && params.members.length > 1 && buildPensionSchedule(params.members, selectedEarliest.retirementAge).map((p, i) => {
                                        const startAge = selectedEarliest.retirementAge + p.startOffset;
                                        if (r.age !== startAge + 1) return null;
                                        return (
                                          <InfoTip key={`p-${i}`} text={`Pensión M${i + 1}: ${formatCurrency(p.monthlyAmount)}/mes`}>
                                            <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold leading-none">P</span>
                                          </InfoTip>
                                        );
                                      })}
                                      {r.finHipoteca && (
                                        <InfoTip text="Hipoteca pagada">
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-sky-100 text-sky-700 text-[9px] font-bold leading-none">H</span>
                                        </InfoTip>
                                      )}
                                      {r.finPrestamo && (
                                        <InfoTip text="Préstamo familiar pagado">
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-purple-100 text-purple-700 text-[9px] font-bold leading-none">F</span>
                                        </InfoTip>
                                      )}
                                      {r.memberAges.map((ma, i) => {
                                        if (ma !== 86) return null;
                                        return (
                                          <InfoTip key={`r-${i}`} text={params.members.length > 1 ? `Residencia M${i + 1}` : 'Entrada en residencia'}>
                                            <span className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-100 text-orange-700 text-[9px] font-bold leading-none">R</span>
                                          </InfoTip>
                                        );
                                      })}
                                    </span>
                                  </td>
                                  {viewMode === 'con-pension' && (
                                    <td className="px-6 sm:px-8 py-2.5 text-right text-sm text-gray-700 whitespace-nowrap">{formatCurrency(r.monthlyPension).replace('€', '€/mes')}</td>
                                  )}
                                  <td className={`px-6 sm:px-8 py-2.5 text-right text-sm ${r.requiredSavings < 0 ? 'text-gray-400' : r.achievable ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {r.requiredSavings > 0
                                      ? formatCurrency(r.requiredSavings)
                                      : r.age === params.lifeExpectancy
                                        ? <InfoTip text={`Los ahorros necesarios a los ${params.lifeExpectancy} años son nulos porque aquí termina la esperanza de vida`}>—</InfoTip>
                                        : '—'}
                                  </td>
                                  <td className="px-6 sm:px-8 py-2.5 text-right text-sm text-gray-600 whitespace-nowrap">
                                    {formatCurrency(r.gastosMensuales).replace('€', '€/mes')}
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
                          {params.members.length > 1 && (
                            <> La columna <strong>Edad</strong> corresponde a la edad del <strong>Integrante 1</strong>. El resto de integrantes se jubilan el mismo año con edades distintas (reflejadas en el resumen).</>
                          )}
                        </p>
                      </div>
                      <div className="px-6 sm:px-8 py-3 bg-amber-50 border-t border-amber-200">
                        <p className="text-xs text-amber-800 leading-relaxed">
                          <strong>⚠️ Nota fiscal:</strong> Los beneficios tributan en la base del ahorro (19%–26%).
                          Los intereses de la cuenta remunerada ya están descontados anualmente.
                          Las plusvalías de las inversiones solo tributan al vender; en la columna <strong>Impuestos</strong> se refleja tanto el impuesto anual sobre intereses como el impuesto sobre plusvalías al retirar durante la jubilación.
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
