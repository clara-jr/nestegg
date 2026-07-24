import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import {
  calculateMortgageGrantedAmount,
  calculateSavings,
  calculateTotalHouseExpenses,
  formatCurrency,
  type SavingsParams,
  type SavingsResult,
} from '../lib/calculations';
import { getSimulatorData, setSimulatorData, subscribe, useLocalStorage } from '../lib/sharedStore';
import {
  SimulatorLayout,
  FormContainer,
  FormSection,
  InputField,
  HouseTypeField,
  ScenarioCard,
  CollapsibleSection,
  ScrollableTable,
  NoteBanner,
  ResultsContainer,
  ScenarioSection,
  ResultsCard,
  ResultsSection,
  SummaryCard,
  CollapsibleFormSection,
  ChartTooltip,
  DistributionSlider,
  type DistributionPeriod,
} from './common';

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
    return () => { unsub(); };
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

  const distributionPeriods: DistributionPeriod[] = params.distributionPeriods.map((pct, i) => ({
    label: sameDistributionForAll ? 'Todos los años' : `Años ${i * 10 + 1}–${Math.min((i + 1) * 10, params.timeHorizonYears)}`,
    pct: sameDistributionForAll ? params.distributionPeriods[0] ?? 50 : pct,
    index: i,
  }));

  return (
    <SimulatorLayout>
      <FormContainer>
        <FormSection title="Ahorros Iniciales" cols="double">
          <InputField
            label="Ahorros Totales Iniciales (€)"
            value={params.initialTotalSavings}
            onChange={(v) => handleInputChange('initialTotalSavings', v)}
          />
          {(params.baseCost > 0 || hasFamilyLoan || mortgageGrantedAmount > 0 || params.reformCosts > 0 || params.furnitureCosts > 0) && (
            <SummaryCard
              label="Disponible para Invertir"
              value={formatCurrency(initialAvailableForInvestment)}
              subtitle="Ahorros totales − gastos finales + hipoteca concedida + préstamo familiar"
              variant={initialAvailableForInvestment >= 0 ? 'positive' : 'negative'}
            />
          )}
          <div className="md:col-span-2 space-y-3">
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
          <div className="md:col-span-3">
            <DistributionSlider
              periods={distributionPeriods}
              sameForAll={sameDistributionForAll}
              showSameForAllToggle={params.timeHorizonYears > 10}
              onToggleSameForAll={(checked) => {
                setSameDistributionForAll(checked);
                if (checked) {
                  const first = params.distributionPeriods[0] ?? 50;
                  setParams(prev => ({ ...prev, distributionPeriods: prev.distributionPeriods.map(() => first) }));
                }
              }}
              onChange={handleDistributionChange}
            />
          </div>
        </FormSection>

        <CollapsibleFormSection
          title="Incluir Compra de Casa 🏡"
          isOpen={includeHousePurchase}
          onToggle={() => handleToggleHousePurchase(!includeHousePurchase)}
        >
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
              <SummaryCard
                label="Gastos Finales de la Casa"
                value={formatCurrency(totalHouseExpenses)}
                variant="info"
              />
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
                <SummaryCard
                  label="Préstamo Hipotecario Estimado"
                  value={<>{formatCurrency(mortgageGrantedAmount)}{params.baseCost > 0 && <span className="text-sm font-normal text-gray-500"> ({Math.round(mortgageGrantedAmount / params.baseCost * 100)}%)</span>}</>}
                  className={params.baseCost === 0 ? 'bg-gray-100 !border-gray-200' : undefined}
                  variant="info"
                />
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
        </CollapsibleFormSection>

        <FormSection title="Horizonte" cols="single">
          <InputField
            label="Años a Simular"
            value={params.timeHorizonYears}
            onChange={(v) => handleInputChange('timeHorizonYears', v)}
          />
        </FormSection>
      </FormContainer>

      {result && (
        <ResultsContainer>
          <ScenarioSection>
            <ScenarioCard label="Ahorro Inicial Invertible" value={formatCurrency(result.initialAvailableForInvestment)} />
            <ScenarioCard label="Aporte Mensual" value={formatCurrency(params.monthlyContribution)} hint={monthlyHint} />
            {params.baseCost > 0 && (
              <ScenarioCard label="Coste Casa" value={formatCurrency(result.totalHouseExpenses)} />
            )}
            {(params.monthlyMortgagePayment > 0 || hasFamilyLoan) && (<>
              {params.monthlyMortgagePayment > 0 ? (<>
                <ScenarioCard label="Préstamo Hipotecario" value={formatCurrency(result.mortgageGrantedAmount)} />
                <ScenarioCard label="Cuota Hipoteca" value={formatCurrency(params.monthlyMortgagePayment)} />
                <ScenarioCard label="Duración Hipoteca" value={`${params.mortgageDurationYears} años`} />
              </>) : (
                <ScenarioCard label="Préstamo Hipotecario" value="Inactivo" />
              )}
              {hasFamilyLoan ? (<>
                <ScenarioCard label="Cuota Préstamo Familiar" value={formatCurrency(familyLoanMonthlyPayment)} />
                <ScenarioCard label="Duración Préstamo Familiar" value={`${params.familyLoanDurationYears} años`} />
              </>) : (
                <ScenarioCard label="Préstamo Familiar" value="Inactivo" />
              )}
            </>)}
            <ScenarioCard label="Horizonte" value={`${params.timeHorizonYears} años`} />
          </ScenarioSection>

          <ResultsSection title="Resultados" gridCols="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ResultsCard label="Total Ahorrado" value={formatCurrency(result.totalSavings)} icon="💰" />
            <ResultsCard label="Cuenta Remunerada" value={formatCurrency(result.finalSavingsAccount)} icon="🏦" />
            <ResultsCard label="Inversiones" value={formatCurrency(result.finalInvestments)} icon="📈" />
          </ResultsSection>

          {(params.baseCost > 0 || params.monthlyContribution > 0 || parsedInitialSavingsAccount.amount > 0 || parsedInitialInvestments.amount > 0) && (
            <CollapsibleSection
              title="Desglose Anual"
              isOpen={showDetail}
              onToggle={() => setShowDetail(!showDetail)}
            >
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
                    <RechartsTooltip content={<ChartTooltip renderContent={(payload) => {
                      const { year, contributed, total } = payload[0].payload as { year: number; contributed: number; total: number };
                      return (<>
                        <p style={{ fontWeight: 700, marginBottom: 4, color: '#111827' }}>{year === 0 ? 'Inicio' : `Año ${year}`}</p>
                        <p style={{ color: '#22c55e', marginBottom: 2 }}>{formatCurrency(total)}</p>
                        <p style={{ color: '#6b7280', marginBottom: 2 }}>{formatCurrency(contributed)}</p>
                        <p style={{ color: '#aeb0b4' }}>(+ {formatCurrency(total - contributed)})</p>
                      </>);
                    }} />} />
                    <Legend wrapperStyle={{ fontFamily: 'Heebo, sans-serif', fontSize: '12px' }} />
                    <Line type="monotone" dataKey="contributed" name="Aportado" stroke="#6b7280" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="#22c55e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ScrollableTable
                columns={[
                  { title: 'Año', align: 'left' },
                  { title: 'Cuenta', align: 'right' },
                  { title: 'Inversiones', align: 'right' },
                  { title: 'Total', align: 'right' },
                  { title: 'A cuenta', align: 'right', muted: true },
                  { title: 'A inversiones', align: 'right', muted: true },
                  { title: 'Impuestos', align: 'right' },
                ]}
                rows={result.monthlyBreakdown
                  .filter((m, i, arr) => m.month === 12 || i === arr.length - 1)
                  .map((entry) => [
                    { content: `${entry.year}º`, className: 'font-medium text-gray-900' },
                    formatCurrency(entry.savingsAccount),
                    formatCurrency(entry.investments),
                    { content: formatCurrency(entry.savingsAccount + entry.investments), className: 'font-semibold text-gray-900' },
                    { content: entry.yearlyToAccount > 0 ? formatCurrency(entry.yearlyToAccount) : formatCurrency(0), className: entry.yearlyToAccount < 0 ? 'text-red-600' : entry.yearlyToAccount > 0 ? 'text-gray-600' : 'text-gray-400' },
                    { content: entry.yearlyToInvestment > 0 ? formatCurrency(entry.yearlyToInvestment) : formatCurrency(0), className: entry.yearlyToInvestment < 0 ? 'text-red-600' : entry.yearlyToInvestment > 0 ? 'text-gray-600' : 'text-gray-400' },
                    { content: entry.yearlyGainsTaxPaid > 0 ? formatCurrency(entry.yearlyGainsTaxPaid) : '-', className: 'text-red-600' },
                  ])}
              />
              <NoteBanner variant="warning">
                <strong>⚠️ Nota fiscal:</strong> Los beneficios tributan en la base del ahorro (19%–26%).
                Los intereses de la cuenta remunerada ya están descontados anualmente.
                Las plusvalías de inversiones solo tributan al vender, por lo que no se han descontado en la simulación al asumir <i>buy-and-hold</i>;
                si se vendieran al final del horizonte, se pagarían <strong>{formatCurrency(result.investmentSaleTax)}</strong> en impuestos,
                con lo que el dinero total neto resultante de la simulación sería <strong>{formatCurrency(result.totalSavings - result.investmentSaleTax)}</strong>.
              </NoteBanner>
            </CollapsibleSection>
          )}
        </ResultsContainer>
      )}
    </SimulatorLayout>
  );
}
