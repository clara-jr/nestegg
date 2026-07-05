import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency } from '../lib/calculations';
import { calculateAffordability, type AffordabilityParams, type AffordabilityResult, type MemberIncome } from '../lib/affordability';
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
        <Tooltip text={disabledTitle}>
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
        </Tooltip>
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

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex items-center cursor-pointer group">
      {children}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs leading-tight whitespace-normal max-w-[calc(100vw-2rem)] sm:max-w-md break-words shadow-lg z-50 pointer-events-none normal-case tracking-normal font-normal text-left opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {text}
      </span>
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
    return unsub;
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
    <div className="min-h-screen py-6 px-3 sm:px-4 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-6 md:gap-8">
          <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); }}>
              <FormSection title="Ingresos" cols="single">
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
                      <InputField
                        label="Salario Bruto Anual (€)"
                        value={member.annualGrossSalary}
                        onChange={(v) => handleMemberChange(i, v)}
                      />
                      {params.members.length > 1 && result.memberNetMonthlyIncomes[i] > 0 && (
                        <p className="text-xs text-gray-500">~{formatCurrency(result.memberNetMonthlyIncomes[i])}/netos al mes</p>
                      )}
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
                <article className={`rounded-lg px-4 py-3 border flex flex-col justify-center ${result.availableForHouse > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Ahorros Disponibles</p>
                  <p className={`text-xl font-bold ${result.availableForHouse > 0 ? 'text-emerald-700' : 'text-gray-500'}`}>
                    {formatCurrency(result.availableForHouse)}
                  </p>
                  <p className="text-xs mt-0.5 text-gray-500">Ahorros − colchón</p>
                </article>
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
                <div className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-200 flex flex-col justify-center gap-2 md:col-span-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Ratio Esfuerzo</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">10%</span>
                    <span className="text-lg font-bold text-gray-900">{params.debtToIncomeRatio}%</span>
                    <span className="text-xs text-gray-500">50%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="50"
                    value={params.debtToIncomeRatio}
                    onChange={(e) => handleInputChange('debtToIncomeRatio', Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-gray-700"
                  />
                  <p className="text-xs text-gray-500">% de ingresos netos destinado a la hipoteca</p>
                </div>
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
            </form>
          </section>

          <main>
            <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm space-y-5">
              <section className="-mx-6 sm:-mx-8 px-6 sm:px-8 first:pt-0 pb-5">
                <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider mb-3">Datos del escenario</h3>
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Ingreso Neto Mensual</p>
                    <p className="text-base font-bold text-gray-900">{formatCurrency(result.totalNetMonthlyIncome)}</p>
                  </article>
                  <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Cuota Máxima</p>
                    <p className="text-base font-bold text-gray-900">{formatCurrency(result.maxMonthlyMortgagePayment)}/mes</p>
                  </article>
                  <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Impuestos ({params.isNewBuild ? '11.2' : '6.5'}%)</p>
                    <p className="text-base font-bold text-gray-900">{formatCurrency(result.estimatedTaxes)}</p>
                  </article>
                  <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Gastos Inmobiliaria</p>
                    <p className="text-base font-bold text-gray-900">{formatCurrency(result.estimatedRealEstateFees)}</p>
                  </article>
                  <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Capital Empleado</p>
                    <p className="text-base font-bold text-gray-900">{formatCurrency(result.availableForHouse)}</p>
                  </article>
                  {hasFamilyLoan && (<>
                    <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Cuota Préstamo Familiar</p>
                      <p className="text-base font-bold text-gray-900">{formatCurrency(familyLoanMonthlyPayment)}/mes</p>
                    </article>
                    <article className="bg-gray-50 rounded-lg px-3.5 py-3 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Duración Préstamo Familiar</p>
                      <p className="text-base font-bold text-gray-900">{params.familyLoanDurationYears} años</p>
                    </article>
                  </>)}
                </div>
              </section>

              <section className="-mx-6 sm:-mx-8 px-6 sm:px-8 pt-5 border-t border-gray-200">
                <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider mb-4">Resultados</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <ResultCard label="Precio Máximo de la Casa" value={formatCurrency(result.maxBaseHousePrice)} icon="🏠" />
                  <article className="bg-white border border-gray-200 rounded-lg p-4 transition-all hover:shadow-sm hover:border-gray-300">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">🏦</span>
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Hipoteca Máxima ({result.ltvRatio}%)</p>

                    </div>
                    <p className="text-xl font-bold text-gray-900 break-words">{formatCurrency(result.maxMortgageAmount)}</p>
                  </article>
                  <ResultCard label="Entrada Total" value={formatCurrency(result.totalDownPayment)} icon="🔑" />
                  <ResultCard label="Cuota Mensual Máxima" value={`${formatCurrency(result.maxMonthlyMortgagePayment)}/mes`} icon="💳" />
                </div>
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <p className="text-xs text-amber-800 leading-relaxed">
                    <strong>⚠️ Nota:</strong> {hasSalary && result.constraintType === 'income'
                      ? `El límite son tus ingresos: la hipoteca máxima (${formatCurrency(result.maxMortgageByIncome)}) y todo tu capital (${formatCurrency(result.availableForHouse)}) determinan el precio máximo.`
                      : hasSalary
                        ? `El límite es tu capital: los bancos prestan hasta el 80% y el ${formatCurrency(result.availableForHouse)} disponible cubre justo el 20% de entrada + impuestos (${params.isNewBuild ? '11,2%' : '6,5%'}) + comisión inmobiliaria (${params.realEstatePercentage}%) + reforma.`
                        : 'Introduce al menos un salario para obtener un desglose detallado.'
                    } {hasSalary && `El ratio de esfuerzo (${params.debtToIncomeRatio}%) se aplica sobre el ingreso neto mensual${params.members.length > 1 ? ' conjunto' : ''} de ${formatCurrency(result.totalNetMonthlyIncome)}.`}
                  </p>
                </div>
              </section>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
