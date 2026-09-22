import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { calculateNetSalary, calculateTax, formatAxisCurrency, formatCurrency, formatSigned } from '../lib/calculations';
import { useFontsReady } from '../lib/fonts';
import { useI18n } from '../lib/i18n';
import {
  buildPensionSchedule,
  calculateAllRetirementAges,
  findRequiredSavings,
  generateDefaultPeriods,
  getDistributionPeriodIndex,
  getNetMonthlyContribution,
  getPeriodAgeRange,
  simulateDetailedPath,
  simulateRetirementPath,
  type RetirementParams,
  type RetirementAgeResult,
  type YearDetail,
  type MemberConfig,
} from '../lib/retirement';
import { getSimulatorData, setSimulatorData, subscribe, useLocalStorage } from '../lib/sharedStore';
import {
  SimulatorLayout,
  FormContainer,
  FormSection,
  InputField,
  Tooltip,
  ChartTooltip,
  MemberCard,
  AddMemberButton,
  CollapsibleSection,
  ScrollableTable,
  NoteBanner,
  ResultsContainer,
  ScenarioSection,
  ScenarioCard,
  ResultsSection,
  ResultsCard,
  DistributionSlider,
  SingleRangeSlider,
  Icon,
  SimulatorLoading,
  type DistributionPeriod,
} from './common';

type ViewMode = 'sin-pension' | 'con-pension';

export default function RetirementSimulator() {
  const { t } = useI18n();
  const defaultMember: MemberConfig = {
    currentAge: 30,
    currentSalary: 0,
    yearsContributed: 10,
  };

  const [params, setParams, storageReady] = useLocalStorage<RetirementParams>('retirement-params', () => {
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

  const fontsReady = useFontsReady();

  const storageReadyRef = useRef(storageReady);
  useEffect(() => { storageReadyRef.current = storageReady; });

  useEffect(() => {
    if (!storageReady) return;
    setParams(prev => {
      let changed = false;
      const next = { ...prev };
      if (next.mortgageDurationYears === undefined) { next.mortgageDurationYears = 0; changed = true; }
      if (next.familyLoanDurationYears === undefined) { next.familyLoanDurationYears = 0; changed = true; }
      return changed ? next : prev;
    });
  }, [storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    const numPeriods = Math.ceil(params.lifeExpectancy / 10);
    setParams(prev => {
      if (prev.distributionPeriods.length === numPeriods) return prev;
      const updated = [...prev.distributionPeriods];
      while (updated.length < numPeriods) updated.push(50);
      const trimmed = updated.slice(0, numPeriods);
      for (let i = 0; i < Math.min(2, numPeriods); i++) trimmed[i] = 100;
      return { ...prev, distributionPeriods: trimmed };
    });
  }, [params.lifeExpectancy, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    const totalNetSalary = params.members.reduce((sum, m) => sum + calculateNetSalary(m.currentSalary), 0);
    const totalDebt = params.monthlyMortgagePayment + params.familyLoanMonthlyPayment;
    const derived = Math.max(0, Math.round(totalNetSalary / 12 - params.monthlyContribution - totalDebt));
    setParams(prev => {
      if (Math.abs(prev.monthlyExpensesPreResidency - derived) < 0.01) return prev;
      return { ...prev, monthlyExpensesPreResidency: derived };
    });
  }, [params.members, params.monthlyContribution, params.monthlyMortgagePayment, params.familyLoanMonthlyPayment, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    const refAge = params.members[0].currentAge;
    setParams(prev => {
      const newEndAge = prev.mortgageDurationYears > 0 ? refAge + prev.mortgageDurationYears : 0;
      const newLoanEndAge = prev.familyLoanDurationYears > 0 ? refAge + prev.familyLoanDurationYears : 0;
      if (prev.mortgageEndAge === newEndAge && prev.familyLoanEndAge === newLoanEndAge) return prev;
      return { ...prev, mortgageEndAge: newEndAge, familyLoanEndAge: newLoanEndAge };
    });
  }, [params.members, params.mortgageDurationYears, params.familyLoanDurationYears, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    const salaries = params.members.map(m => m.currentSalary);
    setSimulatorData({ memberSalaries: salaries });
  }, [params.members, storageReady]);

  useEffect(() => {
    const unsub = subscribe(() => {
      if (!storageReadyRef.current) return;
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
    return () => { unsub(); };
  }, []);

  const handleInputChange = (field: keyof RetirementParams, value: any) => {
    const numericValue = typeof value === 'string' ? Number.parseFloat(value) || 0 : value;
    setParams(prev => ({ ...prev, [field]: numericValue }));
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

  const minimumPath = useMemo<YearDetail[]>(() => {
    if (!selectedEarliest) return [];
    const required = viewMode === 'con-pension'
      ? selectedEarliest.requiredSavingsWithPension
      : selectedEarliest.requiredSavingsWithoutPension;
    if (required <= 0) return [];

    const pensions = viewMode === 'con-pension'
      ? buildPensionSchedule(params.members, selectedEarliest.retirementAge)
      : [];

    const projectedTotal = selectedEarliest.projectedSavingsAtRetirement;
    const saRatio = projectedTotal > 0 && selectedEarliest.projectedSavingsAccount > 0
      ? selectedEarliest.projectedSavingsAccount / projectedTotal
      : params.withdrawalPct / 100;

    const projectedInvestments = selectedEarliest.projectedInvestments;
    const cbRatio = projectedInvestments > 0 && selectedEarliest.projectedCostBasis > 0
      ? selectedEarliest.projectedCostBasis / projectedInvestments
      : 1;

    return simulateRetirementPath(
      required * saRatio,
      required * (1 - saRatio),
      required * (1 - saRatio) * cbRatio,
      selectedEarliest.retirementAge,
      pensions,
      params,
    );
  }, [selectedEarliest, viewMode, params]);

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
        const ma = m.currentAge + (age - 1 - refCA);
        return sum + (ma >= params.residencyAge
          ? params.monthlyExpensesInResidency / numM
          : params.monthlyExpensesPreResidency / numM);
      }, 0);
      let gastosMensuales = Math.round(rawExpenses * 100) / 100;
      if (age - 1 < params.mortgageEndAge && params.monthlyMortgagePayment > 0) {
        gastosMensuales += params.monthlyMortgagePayment;
      }
      if (age - 1 < params.familyLoanEndAge && params.familyLoanMonthlyPayment > 0) {
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
        esJubilacion: firstAchievableAge !== null && age === firstAchievableAge + 1,
        finHipoteca: age === params.mortgageEndAge + 1 && params.mortgageEndAge > 0,
        finPrestamo: age === params.familyLoanEndAge + 1 && params.familyLoanEndAge > 0,
        achievable: achievableNow,
      });
    }

    return output;
  }, [results, viewMode, params, selectedEarliest]);

  const chartData = useMemo(() => {
    if (!selectedEarliest || evolvedResults.length === 0) return [];
    const retirementAge = selectedEarliest.retirementAge;
    const required = viewMode === 'con-pension'
      ? selectedEarliest.requiredSavingsWithPension
      : selectedEarliest.requiredSavingsWithoutPension;
    const minPathMap = new Map(minimumPath.map(d => [d.age, d.total]));
    return evolvedResults
      .filter(d => d.age >= retirementAge)
      .map(d => ({
        age: d.age,
        total: d.total,
        minimumTotal: d.age === retirementAge ? required : (minPathMap.get(d.age - 1) ?? null),
      }));
  }, [evolvedResults, minimumPath, selectedEarliest, viewMode]);

  const totalNet = params.members.reduce((sum, m) => sum + calculateNetSalary(m.currentSalary), 0);
  const monthlyNetSalary = totalNet / 12;
  const contributionExceedsSalary = params.monthlyContribution > monthlyNetSalary + 0.01;
  const distributionSliderPeriods: DistributionPeriod[] = visiblePeriods.map(p => ({
    label: sameDistributionForAll ? t('retirement.allPeriods') : t('retirement.periodYears', { start: p.startAge, end: p.endAge }),
    pct: sameDistributionForAll ? (params.distributionPeriods[0] ?? 50) : p.pct,
    index: p.index,
  }));

  return storageReady && fontsReady ? (
    <SimulatorLayout>
      <FormContainer>
        <FormSection title={t('retirement.personalData')} cols="single">
          <div className="space-y-4">
            {params.members.map((member, i) => (
              <MemberCard key={i} index={i} totalMembers={params.members.length} onRemove={params.members.length > 1 ? () => removeMember(i) : undefined}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <InputField
                    label={t('retirement.currentAge')}
                    value={member.currentAge}
                    onChange={(v) => handleMemberChange(i, 'currentAge', v)}
                  />
                  <InputField
                    label={t('retirement.grossSalary')}
                    value={member.currentSalary}
                    onChange={(v) => handleMemberChange(i, 'currentSalary', v)}
                    hint={t('retirement.salaryHint')}
                  />
                  <InputField
                    label={t('retirement.yearsContributed')}
                    value={member.yearsContributed}
                    onChange={(v) => handleMemberChange(i, 'yearsContributed', v)}
                    hint={t('retirement.yearsContributedHint')}
                  />
                </div>
              </MemberCard>
            ))}
            <AddMemberButton onClick={addMember} label={t('common.addMember')} />
          </div>
          <InputField
            label={t('retirement.lifeExpectancy')}
            value={params.lifeExpectancy}
            onChange={(v) => handleInputChange('lifeExpectancy', v)}
            error={params.residencyAge > params.lifeExpectancy ? t('retirement.residencyAgeError') : undefined}
          />
        </FormSection>

        <FormSection title={t('retirement.initialSavingsTitle')} cols="double">
          <InputField
            label={t('retirement.initialSavingsAccount')}
            value={params.initialSavingsAccount}
            onChange={(v) => handleInputChange('initialSavingsAccount', v)}
          />
          <InputField
            label={t('retirement.initialInvestments')}
            value={params.initialInvestments}
            onChange={(v) => handleInputChange('initialInvestments', v)}
          />
          <InputField
            label={t('retirement.savingsAccountRate')}
            value={params.savingsAccountRate}
            onChange={(v) => handleInputChange('savingsAccountRate', v)}
            step="0.1"
          />
          <InputField
            label={t('retirement.investmentRate')}
            value={params.investmentRate}
            onChange={(v) => handleInputChange('investmentRate', v)}
            step="0.1"
          />
        </FormSection>

        <FormSection title={t('retirement.monthlySavings')} cols="single">
          <InputField
            label={t('retirement.monthlyContribution')}
            value={params.monthlyContribution}
            onChange={(v) => handleInputChange('monthlyContribution', v)}
            hint={t('retirement.monthlyContributionHint')}
            error={contributionExceedsSalary ? t('retirement.contributionExceedsSalary', { netSalary: formatCurrency(monthlyNetSalary) }) : undefined}
          />
          <DistributionSlider
            title={t('common.distributionTitle')}
            periods={distributionSliderPeriods}
            sameForAll={sameDistributionForAll}
            showSameForAllToggle={visiblePeriods.length > 1}
            onToggleSameForAll={(checked) => {
              setSameDistributionForAll(checked);
              if (checked) {
                const first = params.distributionPeriods[0] ?? 50;
                setParams(prev => ({ ...prev, distributionPeriods: prev.distributionPeriods.map(() => first) }));
              }
            }}
            onChange={handleDistributionChange}
          />
        </FormSection>

        <FormSection title={t('retirement.mortgageAndLoan')} cols="double">
          <InputField
            label={t('retirement.mortgagePayment')}
            value={params.monthlyMortgagePayment}
            onChange={(v) => handleInputChange('monthlyMortgagePayment', v)}
            hint={t('retirement.mortgageRedirectHint')}
          />
          <InputField
            label={t('retirement.mortgageDuration')}
            value={params.mortgageDurationYears}
            onChange={(v) => handleInputChange('mortgageDurationYears', v)}
            hint={params.mortgageDurationYears > 0 && params.members.length > 0 ? `${t('retirement.endsAtAge', { age: params.members[0].currentAge + params.mortgageDurationYears })}${params.members.length > 1 ? t('retirement.endsAtMember1') : ''}.` : undefined}
          />
          <InputField
            label={t('retirement.familyLoanPayment')}
            value={params.familyLoanMonthlyPayment}
            onChange={(v) => handleInputChange('familyLoanMonthlyPayment', v)}
            hint={t('retirement.familyLoanHint')}
          />
          <InputField
            label={t('retirement.familyLoanDuration')}
            value={params.familyLoanDurationYears}
            onChange={(v) => handleInputChange('familyLoanDurationYears', v)}
            hint={params.familyLoanDurationYears > 0 && params.members.length > 0 ? `${t('retirement.endsAtAge', { age: params.members[0].currentAge + params.familyLoanDurationYears })}${params.members.length > 1 ? t('retirement.endsAtMember1') : ''}.` : undefined}
          />
        </FormSection>

        <FormSection title={t('retirement.retirementExpenses')} cols="double">
          <InputField
            label={t('retirement.residencyExpenses')}
            value={params.monthlyExpensesInResidency}
            onChange={(v) => handleInputChange('monthlyExpensesInResidency', v)}
            hint={t('retirement.residencyExpensesHint')}
          />
          <InputField
            label={t('retirement.residencyAge')}
            value={params.residencyAge}
            onChange={(v) => handleInputChange('residencyAge', v)}
            error={params.residencyAge > params.lifeExpectancy ? t('retirement.residencyAgeError') : undefined}
          />
          <SingleRangeSlider
            title={t('retirement.withdrawals')}
            value={params.withdrawalPct}
            min={0}
            max={100}
            valueLabel={t('common.accountVsInvestments', { acct: params.withdrawalPct, inv: 100 - params.withdrawalPct })}
            description={t('retirement.withdrawalDescription')}
            footer={t('common.accountLeftInvestmentsRight')}
            fullWidth
            onChange={(v) => handleInputChange('withdrawalPct', v)}
          />
        </FormSection>
      </FormContainer>

      {!contributionExceedsSalary && results.length > 0 && (
        <ResultsContainer>
          <ScenarioSection gridCols="grid grid-cols-1 min-[500px]:grid-cols-2 lg:grid-cols-3 gap-3">
            <ScenarioCard label={t('retirement.currentSavings')} value={formatCurrency(params.initialSavingsAccount + params.initialInvestments)} />
            <ScenarioCard label={t('retirement.yields')} value={t('retirement.yieldsValue', { acct: params.savingsAccountRate, inv: params.investmentRate })} />
            <ScenarioCard label={t('retirement.lifeExpectancy')} value={t('retirement.years', { count: params.lifeExpectancy })} />
            <ScenarioCard
              label={t('retirement.fixedExpenses')}
              value={`${formatCurrency(params.monthlyExpensesPreResidency)}${t('retirement.perMonth')}`}
              hint={t('retirement.fixedExpensesHint', { net: formatCurrency(Math.round(totalNet / 12)), contribution: formatCurrency(params.monthlyContribution), debt: formatCurrency(params.monthlyMortgagePayment + params.familyLoanMonthlyPayment), expenses: formatCurrency(params.monthlyExpensesPreResidency) })}
            />
            {(params.monthlyMortgagePayment > 0 || params.familyLoanMonthlyPayment > 0) && (<>
              {params.monthlyMortgagePayment > 0 ? (<>
                <ScenarioCard label={t('retirement.mortgage')} value={`${formatCurrency(params.monthlyMortgagePayment)}${t('retirement.perMonth')}`} />
                <ScenarioCard label={t('retirement.mortgageEndAge')} value={t('retirement.years', { count: params.mortgageEndAge })} />
              </>) : (
                <ScenarioCard label={t('retirement.mortgage')} value={t('retirement.mortgageInactive')} />
              )}
              {params.familyLoanMonthlyPayment > 0 ? (<>
                <ScenarioCard label={t('retirement.familyLoan')} value={`${formatCurrency(params.familyLoanMonthlyPayment)}${t('retirement.perMonth')}`} />
                <ScenarioCard label={t('retirement.familyLoanEndAge')} value={t('retirement.years', { count: params.familyLoanEndAge })} />
              </>) : (
                <ScenarioCard label={t('retirement.familyLoan')} value={t('retirement.loanInactive')} />
              )}
            </>)}
            <ScenarioCard label={t('retirement.residencyAge')} value={t('retirement.years', { count: params.residencyAge })} />
            <ScenarioCard label={t('retirement.residencyExpensesCard')} value={`${formatCurrency(params.monthlyExpensesInResidency)}${t('retirement.perMonth')}`} />
          </ScenarioSection>

          <ResultsSection>
            <div className="space-y-4 sm:col-span-2 lg:col-span-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('retirement.withoutPension')}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ResultsCard
                    label={t('retirement.minRetirementAge')}
                    value={params.members.every(m => m.currentSalary === 0) ? '-' : (earliestWithoutPension ? t('retirement.years', { count: earliestWithoutPension.retirementAge }) : t('retirement.notAchievable'))}
                    icon="user"
                  />
                  {params.members.some(m => m.currentSalary > 0) && (
                  <ResultsCard
                    label={earliestWithoutPension ? t('retirement.savingsNeededAt', { age: earliestWithoutPension.retirementAge }) : t('retirement.savingsWithoutPension')}
                    value={earliestWithoutPension ? formatCurrency(earliestWithoutPension.requiredSavingsWithoutPension) : '—'}
                    icon="wallet"
                  />
                  )}
                </div>
                {earliestWithoutPension && params.members.length > 1 && (
                  <div className="mt-2 text-xs text-gray-600">
                    <p>{t('retirement.memberAgesLabel', { ages: earliestWithoutPension.memberAges.map((age, i) => t('retirement.memberAge', { index: i + 1, age })).join(', ') })}</p>
                  </div>
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {t('retirement.withPension')}
                  {earliestWithPension && ` (${formatCurrency(earliestWithPension.memberPensions.reduce((a, b) => a + b, 0))}${t('retirement.perMonth')}${params.members.length > 1 ? ` ${t('retirement.total')}` : ''})`}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ResultsCard
                    label={t('retirement.minRetirementAge')}
                    value={params.members.every(m => m.currentSalary === 0) ? '-' : (earliestWithPension ? t('retirement.years', { count: earliestWithPension.retirementAge }) : t('retirement.notAchievable'))}
                    icon="user"
                  />
                  {params.members.some(m => m.currentSalary > 0) && (
                  <ResultsCard
                    label={earliestWithPension ? t('retirement.savingsNeededAt', { age: earliestWithPension.retirementAge }) : t('retirement.savingsWithPension')}
                    value={earliestWithPension ? formatCurrency(earliestWithPension.requiredSavingsWithPension) : '—'}
                    icon="wallet"
                  />
                  )}
                </div>
                {earliestWithPension && params.members.length > 1 && (
                  <div className="mt-2 text-xs text-gray-600 space-y-1">
                    <p>{t('retirement.memberAgesLabel', { ages: earliestWithPension.memberAges.map((age, i) => t('retirement.memberAge', { index: i + 1, age })).join(', ') })}</p>
                    <p>{t('retirement.pensionsLabel', { values: earliestWithPension.memberPensions.map((p, i) => t('retirement.memberPension', { index: i + 1, amount: formatCurrency(p) })).join(', ') })}</p>
                  </div>
                )}
                {earliestWithPension && earliestWithPension.memberPensions.some(p => p === 0) && (
                  <div className="mt-2 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-3 py-2">
                    {params.members.length > 1 ? (
                      <>{t('retirement.noPensionMulti')} (<strong>{t('retirement.minYearsReq')}</strong>{t('retirement.last2YearsReq')}{t('retirement.atPensionAge')}).</>
                    ) : (
                      <>{t('retirement.noPensionSingle')} (<strong>{t('retirement.minYearsReq')}</strong>{t('retirement.last2YearsReq')}{t('retirement.atPensionAge')}){t('retirement.estimatedPensionZero', { amount: 0 })}</>
                    )}
                  </div>
                )}
              </div>
            </div>
          </ResultsSection>

          {showDesglose && params.members.some(m => m.currentSalary > 0) && (
            <CollapsibleSection
              title={t('retirement.annualBreakdown')}
              isOpen={showDetail}
              onToggle={() => setShowDetail(!showDetail)}
              headerRight={bothAchievable ? (
                <div className="flex gap-1 bg-zinc-100 rounded-xl p-0.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setViewMode('sin-pension')}
                    className={`cursor-pointer px-3 py-1.5 text-xs font-semibold rounded-md transition-all uppercase tracking-wider ${
                      viewMode === 'sin-pension'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {t('retirement.withoutPensionLower')}
                  </button>
                  <button
                    onClick={() => setViewMode('con-pension')}
                    className={`cursor-pointer px-3 py-1.5 text-xs font-semibold rounded-md transition-all uppercase tracking-wider ${
                      viewMode === 'con-pension'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {t('retirement.withPensionLower')}
                  </button>
                </div>
              ) : (
                <span className="px-3 py-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  {viewMode === 'con-pension' ? t('retirement.withPensionLower') : t('retirement.withoutPensionLower')}
                </span>
              )}
            >
              {chartData.length > 0 && selectedEarliest && (
                <div className="px-6 sm:px-8 pt-5 pb-6 border-b border-gray-200">
                  <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-4">
                    {t('retirement.chartTitle', { age: selectedEarliest.retirementAge, mode: viewMode === 'con-pension' ? t('retirement.chartModeWith') : t('retirement.chartModeWithout') })}
                  </p>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 4, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="age"
                        tick={{ fontSize: 12, fill: '#706f6c', fontFamily: 'var(--font-sans)' }}
                        tickFormatter={(v: number) => t('retirement.years', { count: v })}
                        stroke="#d1d5db"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                      />
                      <YAxis
                        width={56}
                        tick={{ fontSize: 12, fill: '#706f6c', fontFamily: 'var(--font-sans)' }}
                        tickFormatter={(v: number) => formatAxisCurrency(v)}
                        stroke="#d1d5db"
                      />
                       <RechartsTooltip content={<ChartTooltip renderContent={(payload) => {
                         const age = (payload[0]?.payload?.age as number) ?? NaN;
                         return (<>
                           <p style={{ fontWeight: 700, marginBottom: 4, color: '#1b1b18' }}>{t('retirement.years', { count: age })}</p>
                           {payload.map((entry, i) => (
                             <p key={i} style={{ color: entry.color, marginBottom: i < payload.length - 1 ? 2 : 0 }}>
                               {entry.dataKey === 'total' ? t('retirement.tooltipTotal') : t('retirement.tooltipMinimum')}{formatCurrency(entry.value)}
                             </p>
                           ))}
                         </>);
                       }} />} />
                      <Legend wrapperStyle={{ fontFamily: 'var(--font-sans)', fontSize: '12px' }} />
                      <Line type="monotone" dataKey="total" name={t('retirement.chartTotalSaved')} stroke="#1b1b18" strokeWidth={2} dot={false} />
                      {minimumPath.length > 0 && (
                        <Line type="monotone" dataKey="minimumTotal" name={t('retirement.chartMinimumSavings')} stroke="#9b9a95" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <ScrollableTable
                bordered={false}
                columns={[
                  { title: t('retirement.colAge'), align: 'left' },
                  ...(viewMode === 'con-pension' ? [{ title: t('retirement.colPensionEst'), align: 'right' as const }] : []),
                  { title: t('retirement.colNeeded'), align: 'right' },
                  { title: t('retirement.colExpenses'), align: 'right' },
                  { title: t('retirement.colAccount'), align: 'right' },
                  { title: t('retirement.colInvestments'), align: 'right' },
                  { title: t('retirement.colTotal'), align: 'right' },
                  { title: t('retirement.colToAccount'), align: 'right', muted: true },
                  { title: t('retirement.colToInvestments'), align: 'right', muted: true },
                  { title: t('retirement.colTaxes'), align: 'right' },
                ]}
                rows={evolvedResults.map((r) => [
                  {
                    content: (
                      <span className="inline-flex items-center gap-1.5">
                        {r.age - 1}-{r.age}
                        {r.esJubilacion && (
                          <Tooltip text={t('retirement.tooltipRetirementStart')}>
                            <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold leading-none">J</span>
                          </Tooltip>
                        )}
                        {viewMode === 'con-pension' && selectedEarliest && params.members.length === 1 && r.pensionUsada > 0 && r.age > 0 && (() => { const idx = evolvedResults.indexOf(r); return idx >= 2 && evolvedResults[idx - 2].pensionUsada === 0 && evolvedResults[idx - 1].pensionUsada > 0; })() && (
<Tooltip text={t('retirement.tooltipPension', { amount: formatCurrency(r.monthlyPension) })}>
                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold leading-none">P</span>
                        </Tooltip>
                        )}
                        {viewMode === 'con-pension' && selectedEarliest && params.members.length > 1 && buildPensionSchedule(params.members, selectedEarliest.retirementAge).map((p, i) => {
                          const startAge = selectedEarliest.retirementAge + p.startOffset;
                          if (r.age !== startAge + 1 || p.monthlyAmount <= 0) return null;
                          return (
                            <Tooltip key={`p-${i}`} text={t('retirement.tooltipMemberPension', { index: i + 1, amount: formatCurrency(p.monthlyAmount) })}>
                              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold leading-none">P</span>
                            </Tooltip>
                          );
                        })}
                        {r.finHipoteca && (
                          <Tooltip text={t('retirement.tooltipMortgagePaid')}>
                            <span className="flex items-center justify-center w-4 h-4 rounded-full bg-sky-100 text-sky-700 text-[9px] font-bold leading-none">H</span>
                          </Tooltip>
                        )}
                        {r.finPrestamo && (
                          <Tooltip text={t('retirement.tooltipLoanPaid')}>
                            <span className="flex items-center justify-center w-4 h-4 rounded-full bg-purple-100 text-purple-700 text-[9px] font-bold leading-none">F</span>
                          </Tooltip>
                        )}
                        {r.memberAges.map((ma, i) => {
                          if (ma !== params.residencyAge + 1) return null;
                          return (
                            <Tooltip key={`r-${i}`} text={params.members.length > 1 ? t('retirement.tooltipResidenceMember', { index: i + 1 }) : t('retirement.tooltipResidenceEntry')}>
                              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-orange-100 text-orange-700 text-[9px] font-bold leading-none">R</span>
                            </Tooltip>
                          );
                        })}
                      </span>
                    ),
                    className: 'text-gray-900',
                  },
                  ... (viewMode === 'con-pension'
                    ? [{ content: formatCurrency(r.monthlyPension).replace('€', `€${t('retirement.perMonth')}`), className: 'whitespace-nowrap' }]
                    : []),
                  {
                    content: r.requiredSavings > 0
                      ? formatCurrency(r.requiredSavings)
                      : r.age === params.lifeExpectancy
                        ? <Tooltip text={t('retirement.tooltipNoSavingsNeeded', { age: params.lifeExpectancy })}>—</Tooltip>
                        : '—',
                    className: r.requiredSavings < 0 ? 'text-gray-400' : r.achievable ? 'text-emerald-600' : 'text-red-600',
                  },
                  { content: formatSigned(-r.gastosMensuales).replace('€', `€${t('retirement.perMonth')}`), className: 'text-gray-600 whitespace-nowrap' },
                  formatCurrency(r.cuenta),
                  formatCurrency(r.inversiones),
                  { content: formatCurrency(r.total), className: 'font-semibold text-gray-900' },
                  { content: formatSigned(r.aCuenta), className: r.aCuenta < 0 ? 'text-red-600' : r.aCuenta > 0 ? 'text-emerald-600' : 'text-gray-400' },
                  { content: formatSigned(r.aInversiones), className: r.aInversiones < 0 ? 'text-red-600' : r.aInversiones > 0 ? 'text-emerald-600' : 'text-gray-400' },
                  { content: r.impuestos > 0 ? formatSigned(-r.impuestos) : '—', className: 'text-red-600' },
                ])}
              />
              <NoteBanner variant="info">
                <Icon name="info" className="h-4 w-4 inline mr-1.5 -mt-0.5 text-blue-600" />
                {t('retirement.noteA1')} <strong>{t('retirement.colNeeded')}</strong> {t('retirement.noteA2')} <strong>{t('retirement.wordEnd')}</strong> {t('retirement.noteA3')} <strong>{t('retirement.colTotal')}</strong> {t('retirement.noteA4')} <strong>{t('retirement.wordEnd')}</strong> {t('retirement.noteA5')}
                {t('retirement.noteB1')} <strong>{t('retirement.colTotal')}</strong> {t('retirement.noteB2')} <strong>{t('retirement.colNeeded')}</strong>{t('retirement.noteB3')}
                {params.members.length > 1 && (
                  <> {t('retirement.noteC1')} <strong>{t('retirement.colAge')}</strong> {t('retirement.noteC2')} <strong>{t('retirement.member1')}</strong>. {t('retirement.noteC3')}</>
                )}
              </NoteBanner>
              <NoteBanner variant="warning">
                <strong><Icon name="warning" className="h-4 w-4 inline mr-1.5 -mt-0.5 text-amber-600" /> {t('retirement.noteFiscal')}</strong> {t('retirement.noteTaxBase')}
                {t('retirement.noteTaxInterest')}
                {t('retirement.noteTaxGainsA')} <strong>{t('retirement.colTaxes')}</strong> {t('retirement.noteTaxGainsB')}
              </NoteBanner>
            </CollapsibleSection>
          )}
        </ResultsContainer>
      )}
    </SimulatorLayout>
  ) : (
    <SimulatorLayout>
      <SimulatorLoading />
    </SimulatorLayout>
  );
}
