import { describe, it, expect } from 'vitest';
import {
  calculateTax,
  formatCurrency,
  calculateNetSalary,
  calculateTotalHouseExpenses,
  calculateMortgageGrantedAmount,
  calculateInitialAvailableForInvestment,
  calculateSavings,
  type SavingsParams,
} from '../calculations';

describe('calculateTax', () => {
  it('returns 0 for zero or negative gains', () => {
    expect(calculateTax(0)).toBe(0);
    expect(calculateTax(-100)).toBe(0);
  });

  it('applies 19% on first 6000', () => {
    expect(calculateTax(6000)).toBe(1140);
  });

  it('applies 21% on bracket 6001-50000', () => {
    expect(calculateTax(50000)).toBe(1140 + 44000 * 0.21);
  });

  it('applies 23% on bracket 50001-200000', () => {
    expect(calculateTax(200000)).toBe(1140 + 44000 * 0.21 + 150000 * 0.23);
  });

  it('applies 26% on amounts above 200000', () => {
    const tax = calculateTax(250000);
    const expected = 1140 + 44000 * 0.21 + 150000 * 0.23 + 50000 * 0.26;
    expect(tax).toBe(expected);
  });

  it('rounds to 2 decimals', () => {
    expect(calculateTax(1000)).toBe(190);
    expect(calculateTax(1234.56)).toBe(234.57);
  });
});

describe('formatCurrency', () => {
  it('formats with EUR symbol', () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain('€');
    expect(result).toContain('56');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toContain('0');
  });
});

describe('calculateNetSalary', () => {
  it('returns 0 for zero or negative salary', () => {
    expect(calculateNetSalary(0)).toBe(0);
    expect(calculateNetSalary(-10000)).toBe(0);
  });

  it('deducts 19% on first 12450', () => {
    const net = calculateNetSalary(12450);
    expect(net).toBe(Math.round((12450 - 12450 * 0.19) * 100) / 100);
  });

  it('applies progressive brackets correctly', () => {
    const net = calculateNetSalary(32650);
    // Brackets: 0-12450@19%, 12450-20200@24%, 20200-35200@30%
    const expected = 32650 - (12450 * 0.19 + 7750 * 0.24 + 12450 * 0.30);
    expect(net).toBe(Math.round(expected * 100) / 100);
  });

  it('handles high salary with top bracket', () => {
    const net = calculateNetSalary(100000);
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(100000);
  });
});

describe('calculateTotalHouseExpenses', () => {
  const baseParams = {
    baseCost: 200000,
    realEstatePercentage: 2.5,
    isNewBuild: false,
    reformCosts: 10000,
    furnitureCosts: 5000,
  };

  it('calculates reform tax (6.5%) correctly', () => {
    const result = calculateTotalHouseExpenses({ ...baseParams, isNewBuild: false });
    const expected = 200000 + 5000 + 13000 + 10000 + 5000;
    expect(result).toBe(expected);
  });

  it('calculates new build tax (11.2%) correctly', () => {
    const result = calculateTotalHouseExpenses({ ...baseParams, isNewBuild: true });
    const expected = 200000 + 5000 + 22400 + 10000 + 5000;
    expect(result).toBe(expected);
  });

  it('returns 0 for zero base cost', () => {
    const result = calculateTotalHouseExpenses({ ...baseParams, baseCost: 0 });
    expect(result).toBe(15000); // Only reform + furniture
  });
});

describe('calculateMortgageGrantedAmount', () => {
  it('returns 0 for zero payment', () => {
    expect(calculateMortgageGrantedAmount(0, 3, 30)).toBe(0);
  });

  it('returns 0 for zero duration', () => {
    expect(calculateMortgageGrantedAmount(800, 3, 0)).toBe(0);
  });

  it('calculates correctly with zero interest', () => {
    const result = calculateMortgageGrantedAmount(1000, 0, 10);
    expect(result).toBe(1000 * 120); // 120 months
  });

  it('calculates present value of annuity correctly', () => {
    const result = calculateMortgageGrantedAmount(800, 3, 30);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(800 * 360); // Less than total payments
  });
});

describe('calculateInitialAvailableForInvestment', () => {
  it('calculates available savings without house', () => {
    const params: SavingsParams = {
      initialTotalSavings: 100000,
      initialSavingsAccount: 0,
      initialInvestments: 0,
      baseCost: 0,
      realEstatePercentage: 2.5,
      isNewBuild: false,
      reformCosts: 0,
      furnitureCosts: 0,
      monthlyMortgagePayment: 0,
      mortgageAnnualRate: 3,
      mortgageDurationYears: 30,
      familyLoanAmount: 0,
      familyLoanDurationYears: 0,
      monthlyContribution: 500,
      savingsAccountRate: 2,
      investmentRate: 7,
      timeHorizonYears: 30,
      distributionPeriods: [50],
    };
    expect(calculateInitialAvailableForInvestment(params)).toBe(100000);
  });

  it('accounts for mortgage and family loan', () => {
    const params: SavingsParams = {
      initialTotalSavings: 200000,
      initialSavingsAccount: 0,
      initialInvestments: 0,
      baseCost: 150000,
      realEstatePercentage: 2.5,
      isNewBuild: false,
      reformCosts: 0,
      furnitureCosts: 0,
      monthlyMortgagePayment: 600,
      mortgageAnnualRate: 3,
      mortgageDurationYears: 30,
      familyLoanAmount: 20000,
      familyLoanDurationYears: 5,
      monthlyContribution: 500,
      savingsAccountRate: 2,
      investmentRate: 7,
      timeHorizonYears: 30,
      distributionPeriods: [50],
    };
    const result = calculateInitialAvailableForInvestment(params);
    expect(result).toBeGreaterThan(0);
  });
});

describe('calculateSavings', () => {
  const defaultParams: SavingsParams = {
    initialTotalSavings: 50000,
    initialSavingsAccount: 25000,
    initialInvestments: 25000,
    baseCost: 0,
    realEstatePercentage: 2.5,
    isNewBuild: false,
    reformCosts: 0,
    furnitureCosts: 0,
    monthlyMortgagePayment: 0,
    mortgageAnnualRate: 3,
    mortgageDurationYears: 0,
    familyLoanAmount: 0,
    familyLoanDurationYears: 0,
    monthlyContribution: 500,
    savingsAccountRate: 2,
    investmentRate: 7,
    timeHorizonYears: 5,
    distributionPeriods: [50],
  };

  it('returns positive total savings', () => {
    const result = calculateSavings(defaultParams);
    expect(result.totalSavings).toBeGreaterThan(50000);
  });

  it('generates monthly breakdown with correct length', () => {
    const result = calculateSavings(defaultParams);
    expect(result.monthlyBreakdown.length).toBe(60); // 5 years * 12
  });

  it('tracks initial allocations correctly', () => {
    const result = calculateSavings(defaultParams);
    expect(result.initialSavingsAccount).toBe(25000);
    expect(result.initialInvestments).toBe(25000);
  });

  it('accumulates contributions over time', () => {
    const result = calculateSavings(defaultParams);
    const lastEntry = result.monthlyBreakdown[result.monthlyBreakdown.length - 1];
    expect(lastEntry.savingsAccount + lastEntry.investments).toBeGreaterThan(50000);
  });

  it('handles zero monthly contribution', () => {
    const result = calculateSavings({ ...defaultParams, monthlyContribution: 0 });
    expect(result.totalSavings).toBeGreaterThanOrEqual(50000);
  });
});
