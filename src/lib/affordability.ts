import { calculateNetSalary, calculateMortgageGrantedAmount } from './calculations';

export interface MemberIncome {
  annualGrossSalary: number;
}

export interface AffordabilityParams {
  members: MemberIncome[];
  initialSavings: number;
  cushion: number;
  mortgageAPR: number;
  mortgageDurationYears: number;
  isNewBuild: boolean;
  realEstatePercentage: number;
  reformFurnitureCosts: number;
  familyLoanAmount: number;
  familyLoanDurationYears: number;
  debtToIncomeRatio: number;
}

export type ConstraintType = 'equity' | 'income';

export interface AffordabilityResult {
  totalNetMonthlyIncome: number;
  maxMonthlyMortgagePayment: number;
  maxMortgageByIncome: number;
  maxMortgageAmount: number;
  availableForHouse: number;
  neededEquity: number;
  totalMaxHouseExpense: number;
  maxBaseHousePrice: number;
  memberNetMonthlyIncomes: number[];
  estimatedTaxes: number;
  estimatedRealEstateFees: number;
  downPayment: number;
  totalDownPayment: number;
  extraDownPayment: number;
  constraintType: ConstraintType;
  ltvRatio: number;
}

export function calculateAffordability(params: AffordabilityParams): AffordabilityResult {
  const memberNetAnnualSalaries = params.members.map(m => calculateNetSalary(m.annualGrossSalary));
  const totalNetAnnual = memberNetAnnualSalaries.reduce((sum, s) => sum + s, 0);
  const totalNetMonthlyIncome = Math.round((totalNetAnnual / 12) * 100) / 100;
  const memberNetMonthlyIncomes = memberNetAnnualSalaries.map(s => Math.round((s / 12) * 100) / 100);

  const maxMonthlyMortgagePayment = Math.round((totalNetMonthlyIncome * (params.debtToIncomeRatio / 100)) * 100) / 100;

  const maxMortgageByIncome = maxMonthlyMortgagePayment > 0
    ? Math.round(calculateMortgageGrantedAmount(maxMonthlyMortgagePayment, params.mortgageAPR, params.mortgageDurationYears) * 100) / 100
    : 0;

  const equityFromSavings = Math.max(0, params.initialSavings - params.cushion);
  const effectiveFamilyLoan = params.familyLoanAmount > 0 && params.familyLoanDurationYears > 0 ? params.familyLoanAmount : 0;
  const availableForHouse = Math.round((equityFromSavings + effectiveFamilyLoan) * 100) / 100;

  const taxPct = params.isNewBuild ? 11.2 : 6.5;
  const taxPctDecimal = taxPct / 100;
  const realEstatePctDecimal = params.realEstatePercentage / 100;
  const code_totalPct = 0.2 + taxPctDecimal + realEstatePctDecimal;
  const myPct = taxPctDecimal + realEstatePctDecimal;

  const netEquity = availableForHouse - params.reformFurnitureCosts;

  let maxBaseHousePrice: number;
  let maxMortgageAmount: number;

  if (netEquity <= 0 || maxMortgageByIncome <= 0) {
    maxBaseHousePrice = 0;
    maxMortgageAmount = 0;
  } else {
    const transition = maxMortgageByIncome * code_totalPct / 0.8;

    if (netEquity > transition) {
      // Income constrained: all equity deployed, mortgage capped by income
      maxBaseHousePrice = (maxMortgageByIncome + netEquity) / (1 + myPct);
      maxMortgageAmount = maxMortgageByIncome;
    } else {
      // Equity (LTV) constrained: mortgage capped at 80% LTV
      maxBaseHousePrice = netEquity / code_totalPct;
      maxMortgageAmount = maxBaseHousePrice * 0.8;
    }

    maxBaseHousePrice = Math.round(maxBaseHousePrice * 100) / 100;
    maxMortgageAmount = Math.round(maxMortgageAmount * 100) / 100;
  }

  const downPayment = Math.round(maxBaseHousePrice * 0.2 * 100) / 100;
  const estimatedRealEstateFees = Math.round((maxBaseHousePrice * realEstatePctDecimal) * 100) / 100;
  const estimatedTaxes = Math.round((maxBaseHousePrice * taxPctDecimal) * 100) / 100;
  const totalDownPayment = Math.round(Math.max(0, maxBaseHousePrice - maxMortgageAmount) * 100) / 100;
  const extraDownPayment = Math.round(Math.max(0, totalDownPayment - downPayment) * 100) / 100;

  const totalMaxHouseExpense = Math.round((maxBaseHousePrice + estimatedRealEstateFees + estimatedTaxes + params.reformFurnitureCosts) * 100) / 100;

  const neededEquity = Math.round(Math.max(0, totalMaxHouseExpense - maxMortgageAmount) * 100) / 100;

  const constraintType: ConstraintType = netEquity > 0 && maxMortgageByIncome > 0 && netEquity > maxMortgageByIncome * code_totalPct / 0.8
    ? 'income'
    : 'equity';

  const ltvRatio = maxBaseHousePrice > 0
    ? Math.round((maxMortgageAmount / maxBaseHousePrice) * 100 * 100) / 100
    : 0;

  return {
    totalNetMonthlyIncome,
    maxMonthlyMortgagePayment,
    maxMortgageByIncome,
    maxMortgageAmount,
    availableForHouse,
    neededEquity,
    totalMaxHouseExpense,
    maxBaseHousePrice,
    memberNetMonthlyIncomes,
    estimatedTaxes,
    estimatedRealEstateFees,
    downPayment,
    totalDownPayment,
    extraDownPayment,
    constraintType,
    ltvRatio,
  };
}
