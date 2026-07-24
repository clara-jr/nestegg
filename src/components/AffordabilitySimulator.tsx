import { useEffect, useMemo } from 'react';
import { formatCurrency } from '../lib/calculations';
import { calculateAffordability, type AffordabilityParams, type AffordabilityResult } from '../lib/affordability';
import { getSimulatorData, setSimulatorData, subscribe, useLocalStorage } from '../lib/sharedStore';
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
} from './common';

export default function AffordabilitySimulator() {
  const [params, setParams] = useLocalStorage<AffordabilityParams>('affordability-params', {
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
  });

  const hasFamilyLoan = params.familyLoanAmount > 0 && params.familyLoanDurationYears > 0;
  const familyLoanMonthlyPayment = hasFamilyLoan
    ? params.familyLoanAmount / (params.familyLoanDurationYears * 12)
    : 0;

  const result = useMemo<AffordabilityResult>(() => calculateAffordability(params), [params]);

  useEffect(() => {
    setSimulatorData({
      initialSavings: params.initialSavings,
      memberSalaries: params.members.map(m => m.annualGrossSalary),
      mortgageAPR: params.mortgageAPR,
      realEstatePercentage: params.realEstatePercentage,
    });
  }, [params.initialSavings, params.members, params.mortgageAPR, params.realEstatePercentage]);

  useEffect(() => {
    const unsub = subscribe(() => {
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

  return (
    <SimulatorLayout>
      <FormContainer>
        <FormSection title="Ingresos" cols="single">
          <div className="space-y-4">
            {params.members.map((member, i) => (
              <MemberCard key={i} index={i} totalMembers={params.members.length} onRemove={params.members.length > 1 ? () => removeMember(i) : undefined}>
                <InputField
                  label="Salario Bruto Anual (€)"
                  value={member.annualGrossSalary}
                  onChange={(v) => handleMemberChange(i, v)}
                />
                {params.members.length > 1 && result.memberNetMonthlyIncomes[i] > 0 && (
                  <p className="text-xs text-gray-500">~{formatCurrency(result.memberNetMonthlyIncomes[i])}/netos al mes</p>
                )}
              </MemberCard>
            ))}
            <AddMemberButton onClick={addMember} />
          </div>
        </FormSection>

        <FormSection title="Ahorros" cols="double">
          <InputField
            label="Ahorros Iniciales (€)"
            value={params.initialSavings}
            onChange={(v) => handleInputChange('initialSavings', v)}
            hint="Capital del que dispones para la compra"
          />
          <InputField
            label="Colchón de Seguridad (€)"
            value={params.cushion}
            onChange={(v) => handleInputChange('cushion', v)}
            hint="Dinero que reservas para imprevistos"
          />
          <SummaryCard
            label="Ahorros Disponibles"
            value={formatCurrency(result.availableForHouse)}
            subtitle="Ahorros − colchón"
            variant={result.availableForHouse > 0 ? 'positive' : 'neutral'}
          />
        </FormSection>

        <FormSection title="Vivienda" cols="double">
          <HouseTypeField
            isNewBuild={params.isNewBuild}
            onChange={(v) => handleInputChange('isNewBuild', v)}
          />
          <InputField
            label="Reforma y Muebles (€)"
            value={params.reformFurnitureCosts}
            onChange={(v) => handleInputChange('reformFurnitureCosts', v)}
          />
          <InputField
            label="Comisión Inmobiliaria (%)"
            value={params.realEstatePercentage}
            onChange={(v) => handleInputChange('realEstatePercentage', v)}
            step="0.1"
          />
        </FormSection>

        <FormSection title="Financiación" cols="double">
          <InputField
            label="TAE Hipoteca (%)"
            value={params.mortgageAPR}
            onChange={(v) => handleInputChange('mortgageAPR', v)}
            step="0.1"
          />
          <InputField
            label="Duración (años)"
            value={params.mortgageDurationYears}
            onChange={(v) => handleInputChange('mortgageDurationYears', v)}
          />
          <SingleRangeSlider
            title="Ratio Esfuerzo"
            value={params.debtToIncomeRatio}
            min={10}
            max={50}
            minLabel="10%"
            maxLabel="50%"
            valueLabel={`${params.debtToIncomeRatio}%`}
            description="% de ingresos netos destinado a la hipoteca"
            fullWidth
            headerClassName="mb-0"
            onChange={(v) => handleInputChange('debtToIncomeRatio', v)}
          />
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
      </FormContainer>

      <ResultsContainer>
        <ScenarioSection>
          <ScenarioCard label="Ingreso Neto Mensual" value={formatCurrency(result.totalNetMonthlyIncome)} />
          <ScenarioCard label={`Impuestos (${params.isNewBuild ? '11.2' : '6.5'}%)`} value={formatCurrency(result.estimatedTaxes)} />
          {params.realEstatePercentage > 0 && (
            <ScenarioCard label="Gastos Inmobiliaria" value={formatCurrency(result.estimatedRealEstateFees)} />
          )}
          {params.reformFurnitureCosts > 0 && (
            <ScenarioCard label="Reforma y Muebles" value={formatCurrency(params.reformFurnitureCosts)} />
          )}
          <ScenarioCard label="Capital Empleado" value={formatCurrency(result.availableForHouse)} />
          {hasFamilyLoan && (<>
            <ScenarioCard label="Cuota Préstamo Familiar" value={`${formatCurrency(familyLoanMonthlyPayment)}/mes`} />
            <ScenarioCard label="Duración Préstamo Familiar" value={`${params.familyLoanDurationYears} años`} />
          </>)}
        </ScenarioSection>

        <ResultsSection>
          <ResultsCard label="Precio Máximo" value={formatCurrency(result.maxBaseHousePrice)} icon="🏠" />
          <ResultsCard label={`Hipoteca Máxima (${result.ltvRatio}%)`} value={formatCurrency(result.maxMortgageAmount)} icon="🏦" />
          <ResultsCard label="Entrada Total" value={formatCurrency(result.totalDownPayment)} icon="🔑" />
          {params.mortgageDurationYears > 0 && (
          <ResultsCard label={`Cuota Mensual (${result.monthlyPaymentToIncomePct}%)`} value={`${formatCurrency(result.maxMortgageMonthlyPayment)}/mes`} icon="💳" />
          )}
        </ResultsSection>
        <NoteCard variant="warning">
          <strong>⚠️ Nota:</strong> {hasSalary && result.constraintType === 'income'
            ? `El límite son tus ingresos: la hipoteca máxima (${formatCurrency(result.maxMortgageByIncome)}) y todo tu capital (${formatCurrency(result.availableForHouse)}) determinan el precio máximo.`
            : hasSalary
              ? `El límite es tu capital: los bancos prestan hasta el 80% y los ${formatCurrency(result.availableForHouse)} disponibles cubren justo el 20% de entrada + impuestos (${params.isNewBuild ? '11,2%' : '6,5%'}) + comisión inmobiliaria (${params.realEstatePercentage}%) + reforma.`
              : 'Introduce al menos un salario para obtener un desglose detallado.'
          } {hasSalary && `El ratio de esfuerzo (${params.debtToIncomeRatio}%) se aplica sobre el ingreso neto mensual${params.members.length > 1 ? ' conjunto' : ''} de ${formatCurrency(result.totalNetMonthlyIncome)}.`}
        </NoteCard>
      </ResultsContainer>
    </SimulatorLayout>
  );
}
