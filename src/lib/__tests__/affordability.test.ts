import { describe, it, expect } from 'vitest';
import {
  calculateAffordability,
  type AffordabilityParams,
} from '../affordability';

const defaultParams: AffordabilityParams = {
  members: [{ annualGrossSalary: 40000 }],
  initialSavings: 60000,
  cushion: 10000,
  mortgageAPR: 2.9,
  mortgageDurationYears: 30,
  isNewBuild: false,
  realEstatePercentage: 2.5,
  reformFurnitureCosts: 0,
  familyLoanAmount: 0,
  familyLoanDurationYears: 0,
  debtToIncomeRatio: 30,
};

describe('calculateAffordability', () => {
  it('returns zero when no salary is provided', () => {
    const result = calculateAffordability({
      ...defaultParams,
      members: [{ annualGrossSalary: 0 }],
    });
    expect(result.maxBaseHousePrice).toBe(0);
    expect(result.maxMortgageAmount).toBe(0);
  });

  it('returns positive results with valid inputs', () => {
    const result = calculateAffordability(defaultParams);
    expect(result.maxBaseHousePrice).toBeGreaterThan(0);
    expect(result.maxMortgageAmount).toBeGreaterThan(0);
    expect(result.totalDownPayment).toBeGreaterThan(0);
    expect(result.totalNetMonthlyIncome).toBeGreaterThan(0);
  });

  it('computes net monthly income from salary', () => {
    const result = calculateAffordability(defaultParams);
    expect(result.memberNetMonthlyIncomes[0]).toBeGreaterThan(0);
    expect(result.totalNetMonthlyIncome).toBe(result.memberNetMonthlyIncomes[0]);
  });

  it('applies debt-to-income ratio', () => {
    const result30 = calculateAffordability({ ...defaultParams, debtToIncomeRatio: 30 });
    const result50 = calculateAffordability({ ...defaultParams, debtToIncomeRatio: 50 });
    expect(result50.maxMortgageByIncome).toBeGreaterThan(result30.maxMortgageByIncome);
  });

  it('accounts for cushion in available savings', () => {
    const noCushion = calculateAffordability({ ...defaultParams, cushion: 0 });
    const withCushion = calculateAffordability({ ...defaultParams, cushion: 10000 });
    expect(noCushion.availableForHouse).toBeGreaterThan(withCushion.availableForHouse);
  });

  it('includes family loan in available funds', () => {
    const noLoan = calculateAffordability(defaultParams);
    const withLoan = calculateAffordability({
      ...defaultParams,
      familyLoanAmount: 30000,
      familyLoanDurationYears: 5,
    });
    expect(withLoan.availableForHouse).toBeGreaterThan(noLoan.availableForHouse);
  });

  it('accounts for reform costs', () => {
    const noReform = calculateAffordability(defaultParams);
    const withReform = calculateAffordability({
      ...defaultParams,
      reformFurnitureCosts: 20000,
    });
    expect(withReform.maxBaseHousePrice).toBeLessThanOrEqual(noReform.maxBaseHousePrice);
  });

  it('uses higher tax rate for new builds', () => {
    const reform = calculateAffordability({ ...defaultParams, isNewBuild: false });
    const newBuild = calculateAffordability({ ...defaultParams, isNewBuild: true });
    expect(newBuild.estimatedTaxes).toBeGreaterThan(reform.estimatedTaxes);
  });

  it('computes ltv ratio', () => {
    const result = calculateAffordability(defaultParams);
    if (result.maxBaseHousePrice > 0) {
      expect(result.ltvRatio).toBeGreaterThan(0);
      expect(result.ltvRatio).toBeLessThanOrEqual(100);
    }
  });

  it('determines constraint type', () => {
    const result = calculateAffordability(defaultParams);
    expect(['income', 'equity']).toContain(result.constraintType);
  });

  it('handles multiple members', () => {
    const single = calculateAffordability(defaultParams);
    const multi = calculateAffordability({
      ...defaultParams,
      members: [{ annualGrossSalary: 40000 }, { annualGrossSalary: 30000 }],
    });
    expect(multi.totalNetMonthlyIncome).toBeGreaterThan(single.totalNetMonthlyIncome);
    expect(multi.memberNetMonthlyIncomes.length).toBe(2);
  });

  it('returns zero when savings are below cushion', () => {
    const result = calculateAffordability({
      ...defaultParams,
      initialSavings: 5000,
      cushion: 10000,
    });
    expect(result.availableForHouse).toBe(0);
  });
});
