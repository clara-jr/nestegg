import { useEffect, useMemo, useRef } from 'react';
import { formatCurrency } from '../lib/calculations';
import { calculateAffordability, type AffordabilityParams, type AffordabilityResult } from '../lib/affordability';
import { getSimulatorData, setSimulatorData, subscribe, useLocalStorage } from '../lib/sharedStore';
import { useFontsReady } from '../lib/fonts';
import { useI18n } from '../lib/i18n';
import {
  SimulatorLayout,
  FormContainer,
  FormSection,
  InputField,
  HouseTypeField,
  MemberCard,
  AddMemberButton,
  ResultsContainer,
  ScenarioSection,
  ScenarioCard,
  ResultsSection,
  ResultsCard,
  SummaryCard,
  SingleRangeSlider,
  NoteCard,
  Icon,
  SimulatorLoading,
} from './common';

export default function AffordabilitySimulator() {
  const [params, setParams, storageReady] = useLocalStorage<AffordabilityParams>('affordability-params', {
    members: [{ annualGrossSalary: 0 }],
    initialSavings: 0,
    cushion: 0,
    mortgageAPR: 2.9,
    mortgageDurationYears: 0,
    isNewBuild: false,
    realEstatePercentage: 2.5,
    reformFurnitureCosts: 0,
    familyLoanAmount: 0,
    familyLoanDurationYears: 0,
    debtToIncomeRatio: 30,
    ltvRatio: 80,
  });

  const hasFamilyLoan = params.familyLoanAmount > 0 && params.familyLoanDurationYears > 0;
  const familyLoanMonthlyPayment = hasFamilyLoan
    ? params.familyLoanAmount / (params.familyLoanDurationYears * 12)
    : 0;

  const fontsReady = useFontsReady();
  const { t } = useI18n();

  const result = useMemo<AffordabilityResult>(() => calculateAffordability(params), [params]);

  const storageReadyRef = useRef(storageReady);
  useEffect(() => { storageReadyRef.current = storageReady; });

  useEffect(() => {
    if (!storageReady) return;
    setSimulatorData({
      initialSavings: params.initialSavings,
      memberSalaries: params.members.map(m => m.annualGrossSalary),
      mortgageAPR: params.mortgageAPR,
      realEstatePercentage: params.realEstatePercentage,
    });
  }, [params.initialSavings, params.members, params.mortgageAPR, params.realEstatePercentage, storageReady]);

  useEffect(() => {
    const unsub = subscribe(() => {
      if (!storageReadyRef.current) return;
      const sd = getSimulatorData();
      setParams(prev => {
        const updates: Partial<AffordabilityParams> = {};
        if (sd.initialSavings > 0 && prev.initialSavings !== sd.initialSavings) {
          updates.initialSavings = sd.initialSavings;
        }
        if (sd.memberSalaries.length > 0) {
          const hasDiff = sd.memberSalaries.some(
            (s, i) => s !== (prev.members[i]?.annualGrossSalary ?? -1)
          ) || sd.memberSalaries.length !== prev.members.length;
          if (hasDiff) {
            updates.members = sd.memberSalaries.map(s => ({ annualGrossSalary: s }));
          }
        }
        if (Object.keys(updates).length === 0) return prev;
        return { ...prev, ...updates };
      });
    });
    return () => { unsub(); };
  }, []);

  const handleMemberChange = (index: number, value: string) => {
    const numericValue = Number.parseFloat(value) || 0;
    setParams(prev => {
      const members = [...prev.members];
      members[index] = { annualGrossSalary: numericValue };
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

  const handleInputChange = (field: keyof AffordabilityParams, value: any) => {
    const numericValue = typeof value === 'string' ? Number.parseFloat(value) || 0 : value;
    setParams(prev => ({ ...prev, [field]: numericValue }));
  };

  const hasSalary = params.members.some(m => m.annualGrossSalary > 0);

  return storageReady && fontsReady ? (
    <SimulatorLayout>
      <FormContainer>
        <FormSection title={t('affordability.incomeTitle')} cols="single">
          <div className="space-y-4">
            {params.members.map((member, i) => (
              <MemberCard key={i} index={i} totalMembers={params.members.length} onRemove={params.members.length > 1 ? () => removeMember(i) : undefined}>
                <InputField
                  label={t('affordability.annualGrossSalary')}
                  value={member.annualGrossSalary}
                  onChange={(v) => handleMemberChange(i, v)}
                />
                {params.members.length > 1 && result.memberNetMonthlyIncomes[i] > 0 && (
                  <p className="text-xs text-gray-500">{t('affordability.netMonthly', { amount: formatCurrency(result.memberNetMonthlyIncomes[i]) })}</p>
                )}
              </MemberCard>
            ))}
            <AddMemberButton onClick={addMember} />
          </div>
        </FormSection>

        <FormSection title={t('affordability.savingsTitle')} cols="double">
          <InputField
            label={t('affordability.initialSavings')}
            value={params.initialSavings}
            onChange={(v) => handleInputChange('initialSavings', v)}
            hint={t('affordability.initialSavingsHint')}
          />
          <InputField
            label={t('affordability.cushion')}
            value={params.cushion}
            onChange={(v) => handleInputChange('cushion', v)}
            hint={t('affordability.cushionHint')}
          />
          <SummaryCard
            label={t('affordability.availableSavings')}
            value={formatCurrency(result.availableForHouse)}
            subtitle={t('affordability.availableSavingsSubtitle')}
            variant={result.availableForHouse > 0 ? 'positive' : 'neutral'}
          />
        </FormSection>

        <FormSection title={t('affordability.housingTitle')} cols="double">
          <HouseTypeField
            isNewBuild={params.isNewBuild}
            onChange={(v) => handleInputChange('isNewBuild', v)}
          />
          <InputField
            label={t('affordability.reformFurniture')}
            value={params.reformFurnitureCosts}
            onChange={(v) => handleInputChange('reformFurnitureCosts', v)}
          />
          <InputField
            label={t('affordability.realEstateCommission')}
            value={params.realEstatePercentage}
            onChange={(v) => handleInputChange('realEstatePercentage', v)}
            step="0.1"
          />
        </FormSection>

        <FormSection title={t('affordability.financingTitle')} cols="double">
          <SingleRangeSlider
            title={t('affordability.bankFinancing')}
            value={params.ltvRatio ?? 80}
            min={10}
            max={100}
            minLabel="10%"
            maxLabel="100%"
            valueLabel={`${params.ltvRatio ?? 80}%`}
            description={t('affordability.ltvDescription')}
            fullWidth
            headerClassName="mb-0"
            onChange={(v) => handleInputChange('ltvRatio', v)}
          />
          <InputField
            label={t('affordability.mortgageAPR')}
            value={params.mortgageAPR}
            onChange={(v) => handleInputChange('mortgageAPR', v)}
            step="0.1"
          />
          <InputField
            label={t('affordability.durationYears')}
            value={params.mortgageDurationYears}
            onChange={(v) => handleInputChange('mortgageDurationYears', v)}
          />
          <SingleRangeSlider
            title={t('affordability.effortRatio')}
            value={params.debtToIncomeRatio}
            min={10}
            max={50}
            minLabel="10%"
            maxLabel="50%"
            valueLabel={`${params.debtToIncomeRatio}%`}
            description={t('affordability.effortRatioDescription')}
            fullWidth
            headerClassName="mb-0"
            onChange={(v) => handleInputChange('debtToIncomeRatio', v)}
          />
          <InputField
            label={t('affordability.familyLoan')}
            value={params.familyLoanAmount}
            onChange={(v) => handleInputChange('familyLoanAmount', v)}
            hint={t('affordability.familyLoanHint')}
          />
          <InputField
            label={t('affordability.familyLoanDuration')}
            value={params.familyLoanDurationYears}
            onChange={(v) => handleInputChange('familyLoanDurationYears', v)}
          />
        </FormSection>
      </FormContainer>

      <ResultsContainer>
        <ScenarioSection>
          <ScenarioCard label={t('affordability.netMonthlyIncome')} value={formatCurrency(result.totalNetMonthlyIncome)} />
          <ScenarioCard label={t('affordability.taxes', { pct: params.isNewBuild ? '11.2' : '6.5' })} value={formatCurrency(result.estimatedTaxes)} />
          {params.realEstatePercentage > 0 && (
            <ScenarioCard label={t('affordability.realEstateFees')} value={formatCurrency(result.estimatedRealEstateFees)} />
          )}
          {params.reformFurnitureCosts > 0 && (
            <ScenarioCard label={t('affordability.reformFurnitureCard')} value={formatCurrency(params.reformFurnitureCosts)} />
          )}
          <ScenarioCard label={t('affordability.capitalUsed')} value={formatCurrency(result.availableForHouse)} />
          {hasFamilyLoan && (<>
            <ScenarioCard label={t('affordability.familyLoanPayment')} value={`${formatCurrency(familyLoanMonthlyPayment)}${t('affordability.perMonth')}`} />
            <ScenarioCard label={t('affordability.familyLoanDurationCard')} value={t('affordability.yearsCount', { count: params.familyLoanDurationYears })} />
          </>)}
        </ScenarioSection>

        <ResultsSection>
          <ResultsCard label={t('affordability.maxPrice')} value={formatCurrency(result.maxBaseHousePrice)} icon="home" />
          <ResultsCard label={t('affordability.maxMortgagePct', { pct: result.ltvRatio })} value={formatCurrency(result.maxMortgageAmount)} icon="bank" />
          <ResultsCard label={t('affordability.totalDownPayment')} value={formatCurrency(result.totalDownPayment)} icon="key" />
          {params.mortgageDurationYears > 0 && (
          <ResultsCard label={t('affordability.monthlyPaymentPct', { pct: result.monthlyPaymentToIncomePct })} value={`${formatCurrency(result.maxMortgageMonthlyPayment)}${t('affordability.perMonth')}`} icon="card" />
          )}
        </ResultsSection>
        <NoteCard variant="warning">
          <strong><Icon name="warning" className="h-4 w-4 inline mr-1.5 -mt-0.5 text-amber-600" /></strong> {hasSalary && result.constraintType === 'income'
            ? (<><strong>{t('affordability.limitIncomeTitle')}</strong>{t('affordability.limitIncomeBody', { maxMortgage: formatCurrency(result.maxMortgageByIncome), capital: formatCurrency(result.availableForHouse) })}</>)
            : hasSalary
              ? (<><strong>{t('affordability.limitCapitalTitle')}</strong>{t('affordability.limitCapitalBody', { ltv: params.ltvRatio ?? 80, available: formatCurrency(result.availableForHouse), downPaymentPct: 100 - (params.ltvRatio ?? 80), taxPct: params.isNewBuild ? '11,2%' : '6,5%', commissionPct: params.realEstatePercentage })}</>)
              : t('affordability.noSalary')
          } {hasSalary && t('affordability.effortNote', { ratio: params.debtToIncomeRatio, joint: params.members.length > 1 ? t('affordability.joint') : '', netIncome: formatCurrency(result.totalNetMonthlyIncome) })}
        </NoteCard>
      </ResultsContainer>
    </SimulatorLayout>
  ) : (
    <SimulatorLayout>
      <SimulatorLoading />
    </SimulatorLayout>
  );
}
