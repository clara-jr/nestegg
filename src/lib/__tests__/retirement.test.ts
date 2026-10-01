import { describe, it, expect } from 'vitest';
import {
  estimatePension,
  getDistributionPeriodIndex,
  getFullAgeTableEntry,
  getFullRetirementAge,
  getInflationExpenseDelta,
  getInflationFactor,
  getTotalExpenses,
  generateDefaultPeriods,
  getNetMonthlyContribution,
  getPeriodAgeRange,
  buildPensionSchedule,
  meetsRecentContributionsRequirement,
  type MemberConfig,
  type RetirementParams,
} from '../retirement';

function makeParams(overrides: Partial<RetirementParams> = {}): RetirementParams {
  return {
    members: [{ currentAge: 30, currentSalary: 40000, yearsContributed: 10 }],
    monthlyExpensesPreResidency: 1000,
    monthlyExpensesInResidency: 1200,
    residencyAge: 85,
    lifeExpectancy: 95,
    initialSavingsAccount: 0,
    initialInvestments: 0,
    monthlyContribution: 500,
    savingsAccountRate: 2,
    investmentRate: 7,
    monthlyMortgagePayment: 0,
    mortgageEndAge: 0,
    mortgageDurationYears: 0,
    familyLoanMonthlyPayment: 0,
    familyLoanEndAge: 0,
    familyLoanDurationYears: 0,
    distributionPeriods: generateDefaultPeriods(95),
    withdrawalPct: 10,
    inflationRate: 3,
    ...overrides,
  };
}

describe('getFullAgeTableEntry', () => {
  it('clamps years before 2013 to the 2013 entry', () => {
    const entry = getFullAgeTableEntry(1950);
    expect(entry.year).toBe(2013);
    expect(entry.thresholdMonths).toBe(35 * 12 + 3);
  });

  it('clamps years after 2027 to the final entry (38y6m / 67)', () => {
    const entry = getFullAgeTableEntry(2050);
    expect(entry.year).toBe(2027);
    expect(entry.thresholdMonths).toBe(38 * 12 + 6);
    expect(entry.otherAgeYears).toBe(67);
  });

  it('returns the exact entry for 2026', () => {
    const entry = getFullAgeTableEntry(2026);
    expect(entry.thresholdMonths).toBe(38 * 12 + 3);
    expect(entry.otherAgeYears).toBe(66 + 10 / 12);
  });
});

describe('getFullRetirementAge', () => {
  it('retires at 65 with 38y6m+ cotizados (rule from 2027)', () => {
    // Turning 65 in 2027 → threshold 38y6m. 39 years cotizados → 65.
    expect(getFullRetirementAge(64, 39, 2026)).toBe(65);
  });

  it('retires at 67 with fewer than 38y6m cotizados (rule from 2027)', () => {
    expect(getFullRetirementAge(64, 37, 2026)).toBe(67);
  });

  it('applies the gradual table for the year the member turns 65', () => {
    // Turning 65 in 2026 → threshold 38y3m, otherwise 66y10m.
    expect(getFullRetirementAge(65, 40, 2026)).toBe(65);
    expect(getFullRetirementAge(65, 5, 2026)).toBe(66 + 10 / 12);
  });

  it('uses future contributions projected until 65', () => {
    // 30-year-old with 3 years cotizados: 38 years by 65 → <38y6m → 67.
    expect(getFullRetirementAge(30, 3, 2026)).toBe(67);
    // 30-year-old with 5 years cotizados: 40 years by 65 → ≥38y6m → 65.
    expect(getFullRetirementAge(30, 5, 2026)).toBe(65);
  });
});

describe('estimatePension', () => {
  it('returns 0 if retirement age <= current age', () => {
    expect(estimatePension(40000, 30, 10, 30)).toBe(0);
    expect(estimatePension(40000, 30, 10, 25)).toBe(0);
  });

  it('estimates pension with contributions accumulated until full retirement age', () => {
    // currentAge=30, yearsContributed=0, retirementAge=67 → 37 years total
    const pension = estimatePension(40000, 30, 0, 67);
    expect(pension).toBeGreaterThan(0);
    // Exactly 15 years, all in the last 15 before 67 (52 → 67)
    const pension15 = estimatePension(40000, 52, 0, 67);
    expect(pension15).toBeGreaterThan(0);
  });

  it('increases pension for more years of contribution', () => {
    const short = estimatePension(40000, 40, 0, 67);
    const long = estimatePension(40000, 40, 10, 67);
    expect(long).toBeGreaterThan(short);
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

  it('returns 0 without the minimum 15 years of contributions', () => {
    // 5 cotizados + 9 working years = 14 < 15 → no pension
    expect(estimatePension(40000, 30, 5, 39)).toBe(0);
    // Retiring at 67 with only 2 years by then → no pension
    expect(estimatePension(40000, 65, 0, 67)).toBe(0);
  });

  it('returns 0 when fewer than 2 years fall in the last 15 before the pension starts', () => {
    // Retiring at 40 from age 30: no cotización in [50, 65] → no pension
    expect(estimatePension(40000, 30, 15, 40)).toBe(0);
    expect(estimatePension(40000, 30, 10, 40)).toBe(0);
  });

  it('grants a pension exactly at the 15-year minimum (recent cotización)', () => {
    // 15 years total, all cotizados in the last 15 before 67
    const pension = estimatePension(40000, 52, 0, 67);
    expect(pension).toBeGreaterThan(0);
  });

  it('reduces penalty when retiring at full age 65 with enough contributions', () => {
    // With 39 years by 65 (2027 rule) full age is 65 → no early penalty
    const pension = estimatePension(40000, 26, 39, 65, 2026);
    expect(pension).toBe(Math.round((40000 / 12) * 100) / 100);
  });
});

describe('meetsRecentContributionsRequirement', () => {
  it('passes when recent work overlaps the last 15 years before pension start', () => {
    // Works 15 years before pension start (52 → 67), full age 67
    expect(meetsRecentContributionsRequirement(52, 0, 67, 67)).toBe(true);
    // Works until 63 but pension starts at 67 (window [52, 67]) → 11 years overlap
    expect(meetsRecentContributionsRequirement(33, 30, 63, 67)).toBe(true);
  });

  it('fails when the person stopped working long before the pension starts', () => {
    // Ceases at 40, pension starts at 65 → no overlap with [50, 65]
    expect(meetsRecentContributionsRequirement(30, 15, 40, 65)).toBe(false);
    // Ceases at 40, pension starts at 67 → no overlap with [52, 67]
    expect(meetsRecentContributionsRequirement(30, 15, 40, 67)).toBe(false);
  });

  it('fails with fewer than 2 years of overlap', () => {
    // Only 1 year of work within the 15-year window before pension at 67
    expect(meetsRecentContributionsRequirement(66, 0, 67, 67)).toBe(false);
    // Exactly 2 years → passes
    expect(meetsRecentContributionsRequirement(65, 0, 67, 67)).toBe(true);
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

  it('subtracts the inflation expense delta from the contribution', () => {
    // 1000 contribution, 100 of extra expenses from inflation → 900 to invest
    expect(getNetMonthlyContribution(40, 1000, 0, 0, 0, 0, 100)).toBe(900);
  });

  it('never lets inflation produce a negative contribution', () => {
    expect(getNetMonthlyContribution(40, 500, 0, 0, 0, 0, 1500)).toBe(0);
  });

  it('adds freed debt payments on top of the inflation-adjusted amount', () => {
    expect(getNetMonthlyContribution(65, 1000, 500, 65, 0, 0, 100)).toBe(1400);
  });
});

describe('getInflationExpenseDelta', () => {
  it('is 0 at the current age', () => {
    expect(getInflationExpenseDelta(30, makeParams())).toBe(0);
  });

  it('equals the compounded increase of fixed expenses', () => {
    const params = makeParams();
    expect(getInflationExpenseDelta(50, params)).toBeCloseTo(1000 * (Math.pow(1.03, 20) - 1), 1);
  });

  it('is 0 when inflation is 0%', () => {
    expect(getInflationExpenseDelta(70, makeParams({ inflationRate: 0 }))).toBe(0);
  });

  it('measures the jump when moving into residence expenses', () => {
    const params = makeParams({ residencyAge: 60 });
    // 1000 → 1200/month at age 60, inflated 30 years
    expect(getInflationExpenseDelta(60, params)).toBeCloseTo(
      1200 * Math.pow(1.03, 30) - 1000,
      1,
    );
  });

  it('erodes the contribution so the same income is split between both', () => {
    const params = makeParams({ monthlyContribution: 3000 });
    const delta = getInflationExpenseDelta(60, params);
    const net = getNetMonthlyContribution(60, 3000, 0, 0, 0, 0, delta);
    // What goes into savings plus what inflation added to expenses stays at 3000
    expect(net + delta).toBeCloseTo(3000, 2);
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

describe('getInflationFactor', () => {
  it('returns 1 for zero years or zero inflation', () => {
    expect(getInflationFactor(0, 3)).toBe(1);
    expect(getInflationFactor(10, 0)).toBe(1);
  });

  it('compounds annually', () => {
    expect(getInflationFactor(1, 3)).toBeCloseTo(1.03, 10);
    expect(getInflationFactor(35, 3)).toBeCloseTo(Math.pow(1.03, 35), 10);
  });

  it('never discounts past years', () => {
    expect(getInflationFactor(-5, 3)).toBe(1);
  });

  it('treats a missing rate as zero', () => {
    expect(getInflationFactor(5, Number.NaN)).toBe(1);
  });
});

describe('getTotalExpenses', () => {
  it('keeps today\'s expenses unchanged at the current age', () => {
    expect(getTotalExpenses(30, makeParams())).toBe(1000);
  });

  it('inflates fixed expenses 3% per year from the current age', () => {
    const params = makeParams();
    expect(getTotalExpenses(40, params)).toBeCloseTo(1000 * Math.pow(1.03, 10), 1);
    expect(getTotalExpenses(50, params)).toBeGreaterThan(getTotalExpenses(40, params));
  });

  it('does not inflate when inflation is 0%', () => {
    expect(getTotalExpenses(70, makeParams({ inflationRate: 0 }))).toBe(1000);
  });

  it('switches to residence expenses and keeps inflating them', () => {
    const params = makeParams({ residencyAge: 60 });
    // At 60 the member turns 60 → pre-residency expenses still apply
    expect(getTotalExpenses(59, params)).toBeCloseTo(1000 * Math.pow(1.03, 29), 1);
    expect(getTotalExpenses(60, params)).toBeCloseTo(1200 * Math.pow(1.03, 30), 1);
  });

  it('keeps household expenses constant when split across members', () => {
    const params = makeParams({
      members: [
        { currentAge: 30, currentSalary: 40000, yearsContributed: 10 },
        { currentAge: 35, currentSalary: 30000, yearsContributed: 8 },
      ],
    });
    expect(getTotalExpenses(30, params)).toBe(1000);
    expect(getTotalExpenses(40, params)).toBeCloseTo(1000 * Math.pow(1.03, 10), 1);
  });

  it('falls back to the default rate when inflationRate is missing', () => {
    const params = makeParams();
    delete (params as Partial<RetirementParams>).inflationRate;
    expect(getTotalExpenses(40, params)).toBeCloseTo(1000 * Math.pow(1.03, 10), 1);
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

  it('returns zero pension for member who does not meet the requirements', () => {
    // 65-year-old with only 5 years cotizados → no pension (below the 15-year minimum)
    const members: MemberConfig[] = [
      { currentAge: 65, currentSalary: 40000, yearsContributed: 5 },
    ];
    const scheduleZero = buildPensionSchedule(members, 67);
    expect(scheduleZero[0].monthlyAmount).toBe(0);
    expect(scheduleZero[0].startOffset).toBe(0);

    // Retiring at 40 (from age 30) with 15 years cotizados: nothing in the 15
    // years before the pension starts → no pension
    const early: MemberConfig[] = [
      { currentAge: 30, currentSalary: 40000, yearsContributed: 15 },
    ];
    const scheduleEarly = buildPensionSchedule(early, 40);
    expect(scheduleEarly[0].monthlyAmount).toBe(0);
    expect(scheduleEarly[0].startOffset).toBe(0);
  });
});
