import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import {
  calculateMortgageGrantedAmount,
  calculateSavings,
  calculateTotalHouseExpenses,
  formatAxisCurrency,
  formatCurrency,
  formatSigned,
  type SavingsParams,
  type SavingsResult,
} from '../lib/calculations';
import { getSimulatorData, setSimulatorData, subscribe, useLocalStorage } from '../lib/sharedStore';
import { useFontsReady } from '../lib/fonts';
import { useI18n } from '../lib/i18n';
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
  Icon,
  SimulatorLoading,
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
  const [params, setParams, storageReady] = useLocalStorage<SavingsParams>('savings-params', {
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

  const fontsReady = useFontsReady();
  const { t } = useI18n();

  const storageReadyRef = React.useRef(storageReady);
  React.useEffect(() => { storageReadyRef.current = storageReady; });

  const handleToggleHousePurchase = (include: boolean) => {
    setIncludeHousePurchase(include);
  };

  // Sync distributionPeriods length when timeHorizonYears changes
  React.useEffect(() => {
    if (!storageReady) return;
    const numPeriods = Math.max(1, Math.ceil(params.timeHorizonYears / 10));
    setParams(prev => {
      if (prev.distributionPeriods.length === numPeriods) return prev;
      const updated = [...prev.distributionPeriods];
      while (updated.length < numPeriods) updated.push(0);
      return { ...prev, distributionPeriods: updated.slice(0, numPeriods) };
    });
  }, [params.timeHorizonYears, storageReady]);

  React.useEffect(() => {
    if (!storageReady) return;
    setSimulatorData({ monthlyContribution: params.monthlyContribution });
  }, [params.monthlyContribution, storageReady]);

  React.useEffect(() => {
    if (!storageReady) return;
    setSimulatorData({ initialSavings: params.initialTotalSavings });
  }, [params.initialTotalSavings, storageReady]);

  React.useEffect(() => {
    const unsub = subscribe(() => {
      if (!storageReadyRef.current) return;
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
      parts.push(t('savings.monthlyHintMortgage', { amount: formatCurrency(params.monthlyMortgagePayment) }));
    }
    if (hasFamilyLoan) {
      parts.push(t('savings.monthlyHintFamilyLoan', { amount: formatCurrency(familyLoanMonthlyPayment) }));
    }
    if (parts.length === 0) return undefined;
    return t('savings.monthlyHintFinal', { items: parts.join(` ${t('savings.and')} `), amount: formatCurrency(total) });
  }, [params.monthlyContribution, params.monthlyMortgagePayment, hasFamilyLoan, familyLoanMonthlyPayment, t]);

  React.useEffect(() => {
    if (!storageReady) return;
    setSimulatorData({
      monthlyMortgagePayment: params.monthlyMortgagePayment,
      mortgageDurationYears: params.mortgageDurationYears,
      familyLoanMonthlyPayment,
      familyLoanDurationYears: params.familyLoanDurationYears,
    });
  }, [params.monthlyMortgagePayment, params.mortgageDurationYears, familyLoanMonthlyPayment, params.familyLoanDurationYears, storageReady]);


  const totalHouseExpenses = useMemo(() => calculateTotalHouseExpenses(params), [params]);

  const totalCostHint = useMemo(() => {
    if (params.baseCost <= 0) return t('savings.totalCostHintDefault');
    const realEstateCost = params.baseCost * (params.realEstatePercentage / 100);
    const taxCost = params.baseCost * (params.isNewBuild ? 0.112 : 0.065);
    const reformFurniture = params.reformCosts + params.furnitureCosts;
    return t('savings.totalCostHintDetail', {
      base: formatCurrency(params.baseCost),
      taxes: formatCurrency(taxCost),
      realtor: formatCurrency(realEstateCost),
      furniture: formatCurrency(reformFurniture),
      total: formatCurrency(totalHouseExpenses),
    });
  }, [params.baseCost, params.realEstatePercentage, params.isNewBuild, params.reformCosts, params.furnitureCosts, totalHouseExpenses, t]);
  
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
    ? t('savings.mortgageExceedsBase', { granted: formatCurrency(mortgageGrantedAmount), base: formatCurrency(params.baseCost) })
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
    if (!parsed.isValid) return t('savings.errorInvalidValue');
    if (initialAvailableForInvestment < 0 && amount > 0) return t('savings.errorNoAvailable');
    if (initialAvailableForInvestment >= 0 && amount > initialAvailableForInvestment + 0.01) return t('savings.errorExceedsAvailable');
    return undefined;
  };

  let savingsError = computeError(parsedInitialSavingsAccount, parsedInitialSavingsAccount.amount);
  let investmentsError = computeError(parsedInitialInvestments, parsedInitialInvestments.amount);

  if (!savingsError && !investmentsError && initialAvailableForInvestment >= 0 && allocationDifference < -0.01) {
    if (parsedInitialSavingsAccount.amount > 0) savingsError = t('savings.errorExceedsAvailable');
    if (parsedInitialInvestments.amount > 0) investmentsError = t('savings.errorExceedsAvailable');
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
    if (!storageReady || !result) return;
    setSimulatorData({
      initialSavingsAccount: result.initialSavingsAccount,
      initialInvestments: result.initialInvestments,
    });
  }, [storageReady, result?.initialSavingsAccount, result?.initialInvestments]);

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
    label: sameDistributionForAll ? t('savings.allYears') : t('savings.yearsRange', { from: i * 10 + 1, to: Math.min((i + 1) * 10, params.timeHorizonYears) }),
    pct: sameDistributionForAll ? params.distributionPeriods[0] ?? 50 : pct,
    index: i,
  }));

  return storageReady && fontsReady ? (
    <SimulatorLayout>
      <FormContainer>
        <FormSection title={t('savings.horizon')} cols="single">
          <InputField
            label={t('savings.yearsToSimulate')}
            value={params.timeHorizonYears}
            onChange={(v) => handleInputChange('timeHorizonYears', v)}
          />
        </FormSection>

        <FormSection title={t('savings.initialSavingsTitle')} cols="double">
          <InputField
            label={t('savings.initialTotalSavings')}
            value={params.initialTotalSavings}
            onChange={(v) => handleInputChange('initialTotalSavings', v)}
          />
          {(params.baseCost > 0 || hasFamilyLoan || mortgageGrantedAmount > 0 || params.reformCosts > 0 || params.furnitureCosts > 0) && (
            <SummaryCard
              label={t('savings.availableToInvest')}
              value={formatCurrency(initialAvailableForInvestment)}
              subtitle={t('savings.availableToInvestSubtitle')}
              variant={initialAvailableForInvestment >= 0 ? 'positive' : 'negative'}
            />
          )}
          <div className="md:col-span-2 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InputField
                label={t('savings.initialSavingsAccount')}
                value={initialAllocationInputs.savingsAccount}
                onChange={(v) => handleAllocationChange('savingsAccount', v)}
                type="text"
                hint={initialAvailableForInvestment <= 0 ? t('savings.hintWithReason', { reason: params.initialTotalSavings <= 0 ? t('savings.enterTotalSavings') : t('savings.noAvailable'), example: t('savings.exampleSavings') }) : t('savings.exampleOnly', { example: t('savings.exampleSavings') })}
                error={savingsError}
                disabled={initialAvailableForInvestment <= 0}
                disabledTitle={t('savings.errorNoAvailable')}
              />
              <InputField
                label={t('savings.initialInvestments')}
                value={initialAllocationInputs.investments}
                onChange={(v) => handleAllocationChange('investments', v)}
                type="text"
                hint={initialAvailableForInvestment <= 0 ? t('savings.hintWithReason', { reason: params.initialTotalSavings <= 0 ? t('savings.enterTotalSavings') : t('savings.noAvailable'), example: t('savings.exampleInvestments') }) : t('savings.exampleOnly', { example: t('savings.exampleInvestments') })}
                error={investmentsError}
                disabled={initialAvailableForInvestment <= 0}
                disabledTitle={t('savings.errorNoAvailable')}
              />
              <InputField
                label={t('savings.savingsAccountRate')}
                value={params.savingsAccountRate}
                onChange={(v) => handleInputChange('savingsAccountRate', v)}
                step="0.1"
              />
              <InputField
                label={t('savings.investmentRate')}
                value={params.investmentRate}
                onChange={(v) => handleInputChange('investmentRate', v)}
                step="0.1"
              />
            </div>
          </div>
        </FormSection>

        <FormSection title={t('savings.monthlySavings')} cols="triple">
          <InputField
            label={t('savings.monthlyContribution')}
            value={params.monthlyContribution}
            onChange={(v) => handleInputChange('monthlyContribution', v)}
            hint={t('savings.monthlyContributionHint')}
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
          title={<span className="inline-flex items-center gap-2"><Icon name="home" className="h-4 w-4 text-gray-500" />{t('savings.includeHousePurchase')}</span>}
          isOpen={includeHousePurchase}
          onToggle={() => handleToggleHousePurchase(!includeHousePurchase)}
        >
          <FormSection title={t('savings.houseCosts')} cols="double">
              <InputField
                label={t('savings.baseCost')}
                value={params.baseCost}
                onChange={(v) => handleInputChange('baseCost', v)}
              />
              <InputField
                label={t('savings.realEstatePercentage')}
                value={params.realEstatePercentage}
                onChange={(v) => handleInputChange('realEstatePercentage', v)}
                step="0.1"
              />
              <HouseTypeField
                isNewBuild={params.isNewBuild}
                onChange={(v) => handleInputChange('isNewBuild', v)}
              />
              <InputField
                label={t('savings.reformFurniture')}
                value={params.reformCosts + params.furnitureCosts}
                onChange={(v) => handleReformaMueblesChange(v)}
              />
              <SummaryCard
                label={t('savings.finalHouseCosts')}
                value={formatCurrency(totalHouseExpenses)}
                variant="info"
              />
            </FormSection>

            <FormSection title={t('savings.financing')} cols="triple">
              <InputField
                label={t('savings.monthlyMortgagePayment')}
                value={params.monthlyMortgagePayment}
                onChange={(v) => handleInputChange('monthlyMortgagePayment', v)}
                disabled={params.baseCost === 0}
                error={mortgageExceedsBase}
                hint={params.baseCost === 0 ? t('savings.enterHouseCost') : t('savings.mortgageRedirectHint')}
              />
              <InputField
                label={t('savings.mortgageAPR')}
                value={params.mortgageAnnualRate}
                onChange={(v) => handleInputChange('mortgageAnnualRate', v)}
                step="0.1"
                disabled={params.baseCost === 0}
                hint={params.baseCost === 0 ? t('savings.enterHouseCost') : undefined}
              />
              <InputField
                label={t('savings.mortgageDuration')}
                value={params.mortgageDurationYears}
                onChange={(v) => handleInputChange('mortgageDurationYears', v)}
                disabled={params.baseCost === 0}
                error={mortgageExceedsBase || undefined}
                hint={params.baseCost === 0 ? t('savings.enterHouseCost') : undefined}
              />
              <div className="flex flex-col gap-1.5">
                <SummaryCard
                  label={t('savings.estimatedMortgage')}
                  value={<>{formatCurrency(mortgageGrantedAmount)}{params.baseCost > 0 && <span className="text-sm font-normal text-gray-500"> ({Math.round(mortgageGrantedAmount / params.baseCost * 100)}%)</span>}</>}
                  className={params.baseCost === 0 ? 'bg-zinc-100 !border-gray-200' : undefined}
                  variant="info"
                />
                {params.baseCost === 0 && <p className="text-xs text-gray-400">{t('savings.enterHouseCost')}</p>}
              </div>
              <InputField
                label={t('savings.familyLoan')}
                value={params.familyLoanAmount}
                onChange={(v) => handleInputChange('familyLoanAmount', v)}
                hint={t('savings.familyLoanHint')}
                error={undefined}
              />
              <InputField
                label={t('savings.familyLoanDuration')}
                value={params.familyLoanDurationYears}
                onChange={(v) => handleInputChange('familyLoanDurationYears', v)}
              />
            </FormSection>
        </CollapsibleFormSection>
      </FormContainer>

      {result && (
        <ResultsContainer>
          <ScenarioSection>
            <ScenarioCard label={t('savings.investableInitialSavings')} value={formatCurrency(result.initialAvailableForInvestment)} />
            <ScenarioCard label={t('savings.monthlyContributionCard')} value={formatCurrency(params.monthlyContribution)} hint={monthlyHint} />
            {params.baseCost > 0 && (
              <ScenarioCard label={t('savings.houseCost')} value={formatCurrency(result.totalHouseExpenses)} hint={totalCostHint} />
            )}
            {(params.monthlyMortgagePayment > 0 || hasFamilyLoan) && (<>
              {params.monthlyMortgagePayment > 0 ? (<>
                <ScenarioCard label={t('savings.mortgageLoan')} value={formatCurrency(result.mortgageGrantedAmount)} />
                <ScenarioCard label={t('savings.mortgagePayment')} value={formatCurrency(params.monthlyMortgagePayment)} />
                <ScenarioCard label={t('savings.mortgageDurationCard')} value={t('savings.yearsCount', { count: params.mortgageDurationYears })} />
              </>) : (
                <ScenarioCard label={t('savings.mortgageLoan')} value={t('savings.inactive')} />
              )}
              {hasFamilyLoan ? (<>
                <ScenarioCard label={t('savings.familyLoanPayment')} value={formatCurrency(familyLoanMonthlyPayment)} />
                <ScenarioCard label={t('savings.familyLoanDurationCard')} value={t('savings.yearsCount', { count: params.familyLoanDurationYears })} />
              </>) : (
                <ScenarioCard label={t('savings.familyLoanCard')} value={t('savings.inactive')} />
              )}
            </>)}
            <ScenarioCard label={t('savings.horizon')} value={t('savings.yearsCount', { count: params.timeHorizonYears })} />
          </ScenarioSection>

          <ResultsSection title={t('savings.results')} gridCols="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ResultsCard label={t('savings.totalSaved')} value={formatCurrency(result.totalSavings)} icon="wallet" />
            <ResultsCard label={t('savings.remuneratedAccount')} value={formatCurrency(result.finalSavingsAccount)} icon="bank" />
            <ResultsCard label={t('savings.investments')} value={formatCurrency(result.finalInvestments)} icon="trendingUp" />
          </ResultsSection>

          {(params.baseCost > 0 || params.monthlyContribution > 0 || parsedInitialSavingsAccount.amount > 0 || parsedInitialInvestments.amount > 0) && (
            <CollapsibleSection
              title={t('savings.annualBreakdown')}
              isOpen={showDetail}
              onToggle={() => setShowDetail(!showDetail)}
            >
              <div className="px-6 sm:px-8 pt-5 pb-6 border-b border-gray-200">
                <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-4">
                  {t('savings.contributedVsTotal')}
                </p>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: 4, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="year"
                      tick={{ fontSize: 12, fill: '#706f6c', fontFamily: 'var(--font-sans)' }}
                      tickFormatter={(v: number) => v === 0 ? t('savings.start') : t('savings.yearTick', { year: v })}
                      stroke="#d1d5db"
                    />
                    <YAxis
                      width={56}
                      tick={{ fontSize: 12, fill: '#706f6c', fontFamily: 'var(--font-sans)' }}
                      tickFormatter={(v: number) => formatAxisCurrency(v)}
                      stroke="#d1d5db"
                    />
                    <RechartsTooltip content={<ChartTooltip renderContent={(payload) => {
                      const { year, contributed, total } = payload[0].payload as { year: number; contributed: number; total: number };
                      return (<>
                        <p style={{ fontWeight: 700, marginBottom: 4, color: '#1b1b18' }}>{year === 0 ? t('savings.start') : t('savings.tooltipYear', { year })}</p>
                        <p style={{ color: '#00bc7d', marginBottom: 2 }}>{formatCurrency(total)}</p>
                        <p style={{ color: '#706f6c', marginBottom: 2 }}>{formatCurrency(contributed)}</p>
                        <p style={{ color: '#aeb0b4' }}>(+ {formatCurrency(total - contributed)})</p>
                      </>);
                    }} />} />
                    <Legend wrapperStyle={{ fontFamily: 'var(--font-sans)', fontSize: '12px' }} />
                    <Line type="monotone" dataKey="contributed" name={t('savings.contributed')} stroke="#706f6c" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="total" name={t('savings.total')} stroke="#00bc7d" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ScrollableTable
                bordered={false}
                columns={[
                  { title: t('savings.colYear'), align: 'left' },
                  { title: t('savings.colAccount'), align: 'right' },
                  { title: t('savings.investments'), align: 'right' },
                  { title: t('savings.total'), align: 'right' },
                  { title: t('savings.colToAccount'), align: 'right', muted: true },
                  { title: t('savings.colToInvestments'), align: 'right', muted: true },
                  { title: t('savings.colTaxes'), align: 'right' },
                ]}
                rows={result.monthlyBreakdown
                  .filter((m, i, arr) => m.month === 12 || i === arr.length - 1)
                  .map((entry) => [
                    { content: t('savings.yearTick', { year: entry.year }), className: 'font-medium text-gray-900' },
                    formatCurrency(entry.savingsAccount),
                    formatCurrency(entry.investments),
                    { content: formatCurrency(entry.savingsAccount + entry.investments), className: 'font-semibold text-gray-900' },
                    { content: entry.yearlyToAccount > 0 ? formatSigned(entry.yearlyToAccount) : formatSigned(0), className: entry.yearlyToAccount < 0 ? 'text-red-600' : entry.yearlyToAccount > 0 ? 'text-emerald-600' : 'text-gray-400' },
                    { content: entry.yearlyToInvestment > 0 ? formatSigned(entry.yearlyToInvestment) : formatSigned(0), className: entry.yearlyToInvestment < 0 ? 'text-red-600' : entry.yearlyToInvestment > 0 ? 'text-emerald-600' : 'text-gray-400' },
                    { content: entry.yearlyGainsTaxPaid > 0 ? formatSigned(-entry.yearlyGainsTaxPaid) : '-', className: 'text-red-600' },
                  ])}
              />
              <NoteBanner variant="warning">
                <strong><Icon name="warning" className="h-4 w-4 inline mr-1.5 -mt-0.5 text-amber-600" /> {t('savings.noteFiscal')}</strong> {t('savings.note1')}
                {t('savings.note2')}
                {t('savings.note3a')} <i>buy-and-hold</i>{t('savings.note3b')} <strong>{formatCurrency(result.investmentSaleTax)}</strong> {t('savings.note4')} <strong>{formatCurrency(result.totalSavings - result.investmentSaleTax)}</strong>.
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
