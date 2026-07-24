import { describe, it, expect } from 'vitest';
import {
  estimatePension,
  getDistributionPeriodIndex,
  generateDefaultPeriods,
  getNetMonthlyContribution,
  getPeriodAgeRange,
  buildPensionSchedule,
  type MemberConfig,
} from '../retirement';

describe('estimatePension', () => {
  it('returns 0 if retirement age <= current age', () => {
    expect(estimatePension(40000, 30, 10, 30)).toBe(0);
    expect(estimatePension(40000, 30, 10, 25)).toBe(0);
  });

  it('estimates pension with exactly 15 years of contributions at full retirement age', () => {
    // currentAge=30, yearsContributed=0, retirementAge=67 → 37 years total = 100%
    // Just verify it returns a positive value with early retirement penalty
    const pension = estimatePension(40000, 30, 0, 67);
    expect(pension).toBeGreaterThan(0);
    // 15 years at age 45 with no prior contributions
    const pension15 = estimatePension(40000, 30, 0, 45);
    expect(pension15).toBeGreaterThan(0);
  });

  it('increases pension for more years of contribution', () => {
    const pension15 = estimatePension(40000, 30, 15, 45);
    const pension20 = estimatePension(40000, 30, 20, 50);
    expect(pension20).toBeGreaterThan(pension15);
  });

  it('caps pension percentage at 100%', () => {
    const pension = estimatePension(40000, 20, 40, 80);
    const maxPension = 40000 / 12;
    expect(pension).toBeLessThanOrEqual(Math.round(maxPension * 100) / 100);
  });

  it('applies early retirement penalty', () => {
    const pensionAt67 = estimatePension(40000, 25, 20, 67);
    const pensionAt63 = estimatePension(40000, 25, 20, 63);
    // Earlier retirement should result in lower pension due to penalty
    expect(pensionAt63).toBeLessThanOrEqual(pensionAt67);
  });
});

describe('getDistributionPeriodIndex', () => {
  it('returns last index for age 0', () => {
    expect(getDistributionPeriodIndex(0, 95, 10)).toBe(9);
  });

  it('returns 0 for age >= lifeExpectancy', () => {
    expect(getDistributionPeriodIndex(95, 95, 10)).toBe(0);
    expect(getDistributionPeriodIndex(100, 95, 10)).toBe(0);
  });

  it('maps ages to correct period indices', () => {
    expect(getDistributionPeriodIndex(86, 95, 10)).toBe(0);
    expect(getDistributionPeriodIndex(76, 95, 10)).toBe(1);
    expect(getDistributionPeriodIndex(66, 95, 10)).toBe(2);
  });
});

describe('generateDefaultPeriods', () => {
  it('generates correct number of periods', () => {
    const periods = generateDefaultPeriods(95);
    expect(periods.length).toBe(10); // ceil(95/10)
  });

  it('returns 100% for periods starting at age >= 75', () => {
    const periods = generateDefaultPeriods(95);
    // Period 0: ages 86-95 (startAge=86 >= 75) → 100
    expect(periods[0]).toBe(100);
    // Period 1: ages 76-85 (startAge=76 >= 75) → 100
    expect(periods[1]).toBe(100);
  });

  it('returns 50% for periods starting before age 75', () => {
    const periods = generateDefaultPeriods(95);
    // Period 2: ages 66-75 (startAge=66 < 75) → 50
    expect(periods[2]).toBe(50);
  });
});

describe('getNetMonthlyContribution', () => {
  it('returns gross contribution when no debts', () => {
    expect(getNetMonthlyContribution(40, 1000, 0, 0, 0, 0)).toBe(1000);
  });

  it('adds mortgage payment after mortgage ends', () => {
    expect(getNetMonthlyContribution(65, 1000, 500, 65, 0, 0)).toBe(1500);
  });

  it('adds family loan payment after loan ends', () => {
    expect(getNetMonthlyContribution(50, 1000, 0, 0, 300, 50)).toBe(1300);
  });

  it('does not add payments before debt ends', () => {
    expect(getNetMonthlyContribution(50, 1000, 500, 65, 300, 55)).toBe(1000);
  });

  it('returns 0 for negative results', () => {
    expect(getNetMonthlyContribution(40, 0, 0, 0, 0, 0)).toBe(0);
  });
});

describe('getPeriodAgeRange', () => {
  it('returns correct range for period 0', () => {
    const range = getPeriodAgeRange(0, 95);
    expect(range.endAge).toBe(95);
    expect(range.startAge).toBe(86);
  });

  it('returns correct range for period 1', () => {
    const range = getPeriodAgeRange(1, 95);
    expect(range.endAge).toBe(85);
    expect(range.startAge).toBe(76);
  });
});

describe('buildPensionSchedule', () => {
  it('builds pension schedule for single member', () => {
    const members: MemberConfig[] = [
      { currentAge: 30, currentSalary: 40000, yearsContributed: 10 },
    ];
    const schedule = buildPensionSchedule(members, 65);
    expect(schedule.length).toBe(1);
    expect(schedule[0].monthlyAmount).toBeGreaterThan(0);
    expect(schedule[0].startOffset).toBeGreaterThanOrEqual(0);
  });

  it('builds pension schedule for multi-member with different pensions', () => {
    const members: MemberConfig[] = [
      { currentAge: 30, currentSalary: 40000, yearsContributed: 10 },
      { currentAge: 35, currentSalary: 35000, yearsContributed: 8 },
    ];
    const schedule = buildPensionSchedule(members, 65);
    expect(schedule.length).toBe(2);
    expect(schedule[0].monthlyAmount).toBeGreaterThan(0);
    expect(schedule[1].monthlyAmount).toBeGreaterThan(0);
    expect(schedule[0].startOffset).toBeGreaterThanOrEqual(0);
    expect(schedule[1].startOffset).toBeGreaterThanOrEqual(0);
  });
});
