export interface SavingsParams {
  // Ahorros iniciales
  initialTotalSavings: number; // Ahorro total antes de comprar la casa
  initialSavingsAccount: number; // Cuenta remunerada
  initialInvestments: number; // Inversiones
  
  // Costes de casa
  baseCost: number;
  realEstatePercentage: number; // % inmobiliaria
  isNewBuild: boolean; // 11.2% si es obra nueva, 6.5% si no
  reformCosts: number;
  furnitureCosts: number;
  
  // Hipoteca
  monthlyMortgagePayment: number;
  mortgageAnnualRate: number; // TAE%
  mortgageDurationYears: number;

  // Prestamo familiar (0% interes)
  familyLoanAmount: number;
  familyLoanDurationYears: number;
  
  // Ahorros mensuales
  monthlyContribution: number;
  savingsAccountRate: number; // Tasa anual para cuenta remunerada
  investmentRate: number; // Tasa anual para inversiones
  
  // Horizonte
  timeHorizonYears: number;
  
  // Distribución de ahorros por tramos de 10 años (después de hipoteca)
  // Cada elemento es el % destinado a cuenta remunerada para ese tramo [0-100]
  distributionPeriods: number[];
}

export interface SavingsResult {
  finalSavingsAccount: number;
  finalInvestments: number;
  totalSavings: number;
  initialSavingsAccount: number;
  initialInvestments: number;
  houseDebtRemaining: number;
  totalHouseExpenses: number;
  mortgageGrantedAmount: number;
  initialAvailableForInvestment: number;
  monthlyBreakdown: MonthlyBreakdown[];
}

export interface MonthlyBreakdown {
  month: number;
  year: number;
  savingsAccount: number;
  investments: number;
  mortgagePaymentThisMonth: number;
  familyLoanPaymentThisMonth: number;
  savingsToAccount: number;
  savingsToInvestment: number;
}

export function calculateTotalHouseExpenses(params: Pick<SavingsParams, 'baseCost' | 'realEstatePercentage' | 'isNewBuild' | 'reformCosts' | 'furnitureCosts'>): number {
  const realEstateCost = params.baseCost * (params.realEstatePercentage / 100);
  const taxPercentage = params.isNewBuild ? 0.112 : 0.065;
  const taxCost = params.baseCost * taxPercentage;

  return params.baseCost + realEstateCost + taxCost + params.reformCosts + params.furnitureCosts;
}

export function calculateMortgageGrantedAmount(
  monthlyMortgagePayment: number,
  mortgageAnnualRate: number,
  mortgageDurationYears: number,
): number {
  const months = Math.max(0, Math.floor(mortgageDurationYears * 12));
  if (months === 0 || monthlyMortgagePayment <= 0) {
    return 0;
  }

  const monthlyRate = mortgageAnnualRate / 12 / 100;
  if (monthlyRate === 0) {
    return monthlyMortgagePayment * months;
  }

  return monthlyMortgagePayment * ((1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate);
}

export function calculateInitialAvailableForInvestment(params: SavingsParams): number {
  const totalHouseExpenses = calculateTotalHouseExpenses(params);
  const mortgageGrantedAmount = calculateMortgageGrantedAmount(
    params.monthlyMortgagePayment,
    params.mortgageAnnualRate,
    params.mortgageDurationYears,
  );
  const effectiveFamilyLoan =
    params.familyLoanAmount > 0 && params.familyLoanDurationYears > 0 ? params.familyLoanAmount : 0;

  return params.initialTotalSavings - totalHouseExpenses + mortgageGrantedAmount + effectiveFamilyLoan;
}

export function calculateSavings(params: SavingsParams): SavingsResult {
  const totalHouseExpenses = calculateTotalHouseExpenses(params);
  const mortgageGrantedAmount = calculateMortgageGrantedAmount(
    params.monthlyMortgagePayment,
    params.mortgageAnnualRate,
    params.mortgageDurationYears,
  );
  const effectiveFamilyLoan =
    params.familyLoanAmount > 0 && Math.floor(params.familyLoanDurationYears) > 0 ? params.familyLoanAmount : 0;
  const initialAvailableForInvestment = params.initialTotalSavings - totalHouseExpenses + mortgageGrantedAmount + effectiveFamilyLoan;

  const maxInitialAllocation = Math.max(0, initialAvailableForInvestment);
  const requestedInitialAllocation = Math.max(0, params.initialSavingsAccount) + Math.max(0, params.initialInvestments);
  const allocationScale =
    requestedInitialAllocation > maxInitialAllocation && requestedInitialAllocation > 0
      ? maxInitialAllocation / requestedInitialAllocation
      : 1;

  const savingsAccountAtStart = Math.max(0, params.initialSavingsAccount) * allocationScale;
  const investmentsAtStart = Math.max(0, params.initialInvestments) * allocationScale;
  let savingsAccount = savingsAccountAtStart;
  let investments = investmentsAtStart;
  
  const monthlyBreakdown: MonthlyBreakdown[] = [];
  const totalMonths = params.timeHorizonYears * 12;
  const mortgageMonths = params.mortgageDurationYears * 12;
  const familyLoanMonths = Math.max(0, Math.floor(params.familyLoanDurationYears) * 12);
  const hasFamilyLoan = params.familyLoanAmount > 0 && familyLoanMonths > 0;
  const familyLoanPayment = hasFamilyLoan
    ? params.familyLoanAmount / familyLoanMonths
    : 0;
  
  for (let month = 1; month <= totalMonths; month++) {
    const year = Math.ceil(month / 12);
    let savingsToAccount = 0;
    let savingsToInvestment = 0;
    let mortgagePaymentThisMonth = 0;
    let familyLoanPaymentThisMonth = 0;
    
    // Determinar si aún se paga hipoteca
    if (month <= mortgageMonths) {
      mortgagePaymentThisMonth = params.monthlyMortgagePayment;
    }

    // Prestamo familiar en paralelo (interes 0%)
    if (hasFamilyLoan && familyLoanPayment > 0) {
      const familyLoanEndMonth = familyLoanMonths;
      if (month <= familyLoanEndMonth) {
        familyLoanPaymentThisMonth = familyLoanPayment;
      }
    }

    // Dinero disponible despues de deuda bancaria + familiar
    const remainingMonthly = params.monthlyContribution - mortgagePaymentThisMonth - familyLoanPaymentThisMonth;

    if (remainingMonthly > 0) {
      const periodIndex = Math.min(Math.floor((year - 1) / 10), params.distributionPeriods.length - 1);
      const savingsAccountPct = params.distributionPeriods[periodIndex] ?? 0;
      savingsToAccount = remainingMonthly * (savingsAccountPct / 100);
      savingsToInvestment = remainingMonthly * ((100 - savingsAccountPct) / 100);
    }
    
    // Aplicar intereses mensuales
    const monthlyAccountRate = params.savingsAccountRate / 12 / 100;
    const monthlyInvestmentRate = params.investmentRate / 12 / 100;
    
    savingsAccount = savingsAccount * (1 + monthlyAccountRate) + savingsToAccount;
    investments = investments * (1 + monthlyInvestmentRate) + savingsToInvestment;
    
    monthlyBreakdown.push({
      month: ((month - 1) % 12) + 1,
      year,
      savingsAccount: Math.round(savingsAccount * 100) / 100,
      investments: Math.round(investments * 100) / 100,
      mortgagePaymentThisMonth,
      familyLoanPaymentThisMonth: Math.round(familyLoanPaymentThisMonth * 100) / 100,
      savingsToAccount: Math.round(savingsToAccount * 100) / 100,
      savingsToInvestment: Math.round(savingsToInvestment * 100) / 100,
    });
  }
  
  return {
    finalSavingsAccount: Math.round(savingsAccount * 100) / 100,
    finalInvestments: Math.round(investments * 100) / 100,
    totalSavings: Math.round((savingsAccount + investments) * 100) / 100,
    initialSavingsAccount: Math.round(savingsAccountAtStart * 100) / 100,
    initialInvestments: Math.round(investmentsAtStart * 100) / 100,
    houseDebtRemaining: 0, // Asumimos que la casa fue pagada con los ahorros iniciales
    totalHouseExpenses: Math.round(totalHouseExpenses * 100) / 100,
    mortgageGrantedAmount: Math.round(mortgageGrantedAmount * 100) / 100,
    initialAvailableForInvestment: Math.round(initialAvailableForInvestment * 100) / 100,
    monthlyBreakdown,
  };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}
