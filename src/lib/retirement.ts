import { calculateTax } from './calculations';

export interface RetirementParams {
  currentAge: number;
  currentSalary: number;
  yearsContributed: number;
  monthlyExpensesPreResidency: number;
  monthlyExpensesInResidency: number;
  residencyAge: number;
  lifeExpectancy: number;
  pensionStartAge: number;
  initialSavingsAccount: number;
  initialInvestments: number;
  monthlyContribution: number;
  savingsAccountRate: number;
  investmentRate: number;
  monthlyMortgagePayment: number;
  mortgageEndAge: number;
  familyLoanMonthlyPayment: number;
  familyLoanEndAge: number;
  distributionPeriods: number[];
  withdrawalPct: number;
}

export interface RetirementAgeResult {
  retirementAge: number;
  yearsContributedAtRetirement: number;
  monthlyPension: number;
  requiredSavingsWithoutPension: number;
  requiredSavingsWithPension: number;
  projectedSavingsAtRetirement: number;
  projectedSavingsAccount: number;
  projectedInvestments: number;
  projectedBalanceAtDeathWithoutPension: number;
  projectedBalanceAtDeathWithPension: number;
  achievableWithoutPension: boolean;
  achievableWithPension: boolean;
}

export function estimatePension(
  currentSalary: number,
  currentAge: number,
  yearsContributed: number,
  retirementAge: number,
): number {
  if (retirementAge <= currentAge) return 0;
  const yearsAtRetirement = yearsContributed + Math.max(0, retirementAge - currentAge);
  const totalMonths = Math.max(0, yearsAtRetirement * 12);

  let percentage: number;
  if (totalMonths <= 180) {
    percentage = (totalMonths / 180) * 0.5;
  } else {
    percentage = 0.5;
    const extraMonths = totalMonths - 180;
    const monthsAt021 = Math.min(extraMonths, 106);
    percentage += monthsAt021 * 0.0021;
    const monthsAt019 = Math.max(0, extraMonths - 106);
    percentage += monthsAt019 * 0.0019;
  }
  percentage = Math.min(percentage, 1);

  const fullRetirementAge = yearsAtRetirement >= 38 ? 65 : 67;
  if (retirementAge < fullRetirementAge) {
    const yearsEarly = fullRetirementAge - retirementAge;
    percentage *= Math.max(0.5, 1 - yearsEarly * 0.02);
  }

  const annualPension = currentSalary * percentage;
  return Math.round((annualPension / 12) * 100) / 100;
}

export function getDistributionPeriodIndex(
  age: number,
  lifeExpectancy: number,
  numPeriods: number,
): number {
  if (age <= 0) return numPeriods - 1;
  if (age >= lifeExpectancy) return 0;
  const index = Math.floor((lifeExpectancy - age) / 10);
  return Math.max(0, Math.min(index, numPeriods - 1));
}

export function simulateRetirementPhase(
  savingsAccount: number,
  investments: number,
  costBasis: number,
  retirementAge: number,
  monthlyPension: number,
  params: RetirementParams,
): number {
  const monthlyAccountRate = params.savingsAccountRate / 12 / 100;
  const monthlyInvestmentRate = params.investmentRate / 12 / 100;

  let sa = savingsAccount;
  let inv = investments;
  let investmentCostBasis = costBasis;

  const totalMonths = Math.max(0, (params.lifeExpectancy - retirementAge) * 12);
  let savingsGainsThisYear = 0;
  let previousSavingsGains = 0;
  let totalUnmet = 0;

  for (let month = 1; month <= totalMonths; month++) {
    const totalAgeInMonths = retirementAge * 12 + month - 1;
    const currentAge = Math.floor(totalAgeInMonths / 12);
    const monthInYear = ((month - 1) % 12) + 1;
    const year = Math.ceil(month / 12);

    if (monthInYear === 1 && year > 1) {
      previousSavingsGains = savingsGainsThisYear;
      savingsGainsThisYear = 0;
    }

    let expenses =
      currentAge >= params.residencyAge
        ? params.monthlyExpensesInResidency
        : params.monthlyExpensesPreResidency;

    if (currentAge < params.mortgageEndAge && params.monthlyMortgagePayment > 0) {
      expenses += params.monthlyMortgagePayment;
    }
    if (currentAge < params.familyLoanEndAge && params.familyLoanMonthlyPayment > 0) {
      expenses += params.familyLoanMonthlyPayment;
    }

    const effectivePension = currentAge >= params.pensionStartAge ? monthlyPension : 0;

    const curPeriodIndex = getDistributionPeriodIndex(
      currentAge,
      params.lifeExpectancy,
      params.distributionPeriods.length,
    );
    const curSavingsPct = params.distributionPeriods[curPeriodIndex] ?? 50;

    const accountInterest = sa * monthlyAccountRate;
    savingsGainsThisYear += accountInterest;

    const netFlow = effectivePension - expenses;

    if (netFlow >= 0) {
      const toSavings = netFlow * (curSavingsPct / 100);
      const toInvestments = netFlow * ((100 - curSavingsPct) / 100);
      sa += accountInterest + toSavings;
      inv = inv * (1 + monthlyInvestmentRate) + toInvestments;
      investmentCostBasis += toInvestments;
    } else {
      sa += accountInterest;
      inv = inv * (1 + monthlyInvestmentRate);

      let remaining = -netFlow;

      const usePct = params.withdrawalPct;

      let fromSavings = Math.min(remaining * usePct / 100, Math.max(0, sa));
      sa = Math.max(0, sa - fromSavings);
      remaining -= fromSavings;

      if (remaining > 0.01 && inv > 0.01) {
        const totalValue = inv;
        const costBasisRatio = Math.min(1, investmentCostBasis / totalValue);

        let sellAmount = remaining;
        for (let iter = 0; iter < 10; iter++) {
          const gain = sellAmount * (1 - costBasisRatio);
          const tax = calculateTax(Math.max(0, gain));
          sellAmount = remaining + tax;
        }

        sellAmount = Math.min(sellAmount, totalValue);
        if (sellAmount > 0.01) {
          const actualGain = sellAmount * (1 - costBasisRatio);
          const tax = calculateTax(Math.max(0, actualGain));

          const costBasisSold = sellAmount - actualGain;
          investmentCostBasis = Math.max(0, investmentCostBasis - costBasisSold);
          inv = Math.max(0, inv - sellAmount);

          remaining = Math.max(0, remaining - (sellAmount - tax));
        }
      }

      if (remaining > 0.01) {
        const extra = Math.min(remaining, Math.max(0, sa));
        sa = Math.max(0, sa - extra);
        remaining -= extra;
      }

      if (remaining > 0.01) {
        totalUnmet += remaining;
      }
    }

    if (monthInYear === 6 && year > 1 && previousSavingsGains > 0 && sa > 0.01) {
      const tax = calculateTax(previousSavingsGains);
      const actualTax = Math.min(tax, Math.max(0, sa));
      sa = Math.max(0, sa - actualTax);
    }
  }

  const finalBalance = Math.round((sa + inv) * 100) / 100;
  if (totalUnmet > 0.01) {
    return -totalUnmet;
  }
  return finalBalance;
}

export function findRequiredSavings(
  retirementAge: number,
  monthlyPension: number,
  params: RetirementParams,
  accumulatedSavingsAccount: number,
  accumulatedInvestments: number,
  accumulatedCostBasis?: number,
): number {
  const baseTotal = accumulatedSavingsAccount + accumulatedInvestments;
  const saRatio = baseTotal > 0
    ? accumulatedSavingsAccount / baseTotal
    : params.withdrawalPct / 100;
  const cbRatio = accumulatedInvestments > 0 && accumulatedCostBasis !== undefined
    ? accumulatedCostBasis / accumulatedInvestments
    : 1;

  const zeroResult = simulateRetirementPhase(0, 0, 0, retirementAge, monthlyPension, params);
  if (zeroResult >= 0) return 0;

  let low = 0;
  let high = 10_000_000;

  let result = simulateRetirementPhase(
    high * saRatio, high * (1 - saRatio), high * (1 - saRatio) * cbRatio,
    retirementAge, monthlyPension, params,
  );
  while (result < 0 && high < 1_000_000_000) {
    high *= 2;
    result = simulateRetirementPhase(
      high * saRatio, high * (1 - saRatio), high * (1 - saRatio) * cbRatio,
      retirementAge, monthlyPension, params,
    );
  }

  if (result < 0) return high;

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    const res = simulateRetirementPhase(
      mid * saRatio, mid * (1 - saRatio), mid * (1 - saRatio) * cbRatio,
      retirementAge, monthlyPension, params,
    );
    if (res > 0) {
      high = mid;
    } else {
      low = mid;
    }
    if (high - low < 1) break;
  }

  return Math.max(0, Math.round(high * 100) / 100);
}

export function simulateAccumulationPhase(
  currentAge: number,
  retirementAge: number,
  initialSavingsAccount: number,
  initialInvestments: number,
  grossMonthlyContribution: number,
  savingsAccountRate: number,
  investmentRate: number,
  distributionPeriods: number[],
  lifeExpectancy: number,
  monthlyMortgagePayment: number,
  mortgageEndAge: number,
  familyLoanMonthlyPayment: number,
  familyLoanEndAge: number,
): { savingsAccount: number; investments: number; total: number; investmentCostBasis: number } {
  if (retirementAge <= currentAge) {
    return {
      savingsAccount: initialSavingsAccount,
      investments: initialInvestments,
      total: initialSavingsAccount + initialInvestments,
      investmentCostBasis: initialInvestments,
    };
  }

  const monthlyAccountRate = savingsAccountRate / 12 / 100;
  const monthlyInvestmentRate = investmentRate / 12 / 100;

  let savingsAccount = initialSavingsAccount;
  let investments = initialInvestments;
  let investmentCostBasis = initialInvestments;

  const totalMonths = (retirementAge - currentAge) * 12;

  let savingsGainsThisYear = 0;
  let previousSavingsGains = 0;

  for (let month = 1; month <= totalMonths; month++) {
    const year = Math.ceil(month / 12);
    const totalAgeInMonths = currentAge * 12 + month - 1;
    const currentAgeAtMonth = Math.floor(totalAgeInMonths / 12);

    if (month % 12 === 1 && year > 1) {
      previousSavingsGains = savingsGainsThisYear;
      savingsGainsThisYear = 0;
    }

    const netContrib = getNetMonthlyContribution(
      currentAgeAtMonth,
      grossMonthlyContribution,
      monthlyMortgagePayment,
      mortgageEndAge,
      familyLoanMonthlyPayment,
      familyLoanEndAge,
    );

    const periodIndex = getDistributionPeriodIndex(currentAgeAtMonth, lifeExpectancy, distributionPeriods.length);
    const savingsPct = distributionPeriods[periodIndex] ?? 50;

    const accountInterest = savingsAccount * monthlyAccountRate;
    savingsGainsThisYear += accountInterest;

    if (netContrib > 0) {
      savingsAccount = savingsAccount * (1 + monthlyAccountRate) + netContrib * (savingsPct / 100);
      investments = investments * (1 + monthlyInvestmentRate) + netContrib * ((100 - savingsPct) / 100);
      investmentCostBasis += netContrib * ((100 - savingsPct) / 100);
    } else {
      savingsAccount = savingsAccount * (1 + monthlyAccountRate);
      investments = investments * (1 + monthlyInvestmentRate);
    }

    if (month % 12 === 6 && year > 1 && previousSavingsGains > 0) {
      const tax = calculateTax(previousSavingsGains);
      savingsAccount -= tax;
    }
  }

  return {
    savingsAccount: Math.round(savingsAccount * 100) / 100,
    investments: Math.round(investments * 100) / 100,
    total: Math.round((savingsAccount + investments) * 100) / 100,
    investmentCostBasis: Math.round(investmentCostBasis * 100) / 100,
  };
}

export function calculateAllRetirementAges(
  params: RetirementParams,
): RetirementAgeResult[] {
  const results: RetirementAgeResult[] = [];
  const minRetirementAge = Math.max(30, params.currentAge + 1);
  const maxRetirementAge = Math.min(params.lifeExpectancy - 1, 85);
  const periods = params.distributionPeriods;

  for (let age = minRetirementAge; age <= maxRetirementAge; age++) {
    const monthlyPension = estimatePension(
      params.currentSalary,
      params.currentAge,
      params.yearsContributed,
      age,
    );

    const accResult = simulateAccumulationPhase(
      params.currentAge,
      age,
      params.initialSavingsAccount,
      params.initialInvestments,
      params.monthlyContribution,
      params.savingsAccountRate,
      params.investmentRate,
      periods,
      params.lifeExpectancy,
      params.monthlyMortgagePayment,
      params.mortgageEndAge,
      params.familyLoanMonthlyPayment,
      params.familyLoanEndAge,
    );

    const requiredWithoutPension = findRequiredSavings(age, 0, params, accResult.savingsAccount, accResult.investments, accResult.investmentCostBasis);
    const requiredWithPension = findRequiredSavings(age, monthlyPension, params, accResult.savingsAccount, accResult.investments, accResult.investmentCostBasis);

    const balanceAtDeathWithoutPension = simulateRetirementPhase(
      accResult.savingsAccount, accResult.investments, accResult.investmentCostBasis,
      age, 0, params,
    );
    const balanceAtDeathWithPension = simulateRetirementPhase(
      accResult.savingsAccount, accResult.investments, accResult.investmentCostBasis,
      age, monthlyPension, params,
    );

    results.push({
      retirementAge: age,
      yearsContributedAtRetirement:
        params.yearsContributed + Math.max(0, age - params.currentAge),
      monthlyPension: Math.round(monthlyPension * 100) / 100,
      requiredSavingsWithoutPension: requiredWithoutPension,
      requiredSavingsWithPension: requiredWithPension,
      projectedSavingsAtRetirement: accResult.total,
      projectedSavingsAccount: accResult.savingsAccount,
      projectedInvestments: accResult.investments,
      projectedBalanceAtDeathWithoutPension: balanceAtDeathWithoutPension,
      projectedBalanceAtDeathWithPension: balanceAtDeathWithPension,
      achievableWithoutPension: accResult.total >= requiredWithoutPension,
      achievableWithPension: accResult.total >= requiredWithPension,
    });
  }

  return results;
}

export function generateDefaultPeriods(lifeExpectancy: number): number[] {
  const numPeriods = Math.ceil(lifeExpectancy / 10);
  return Array.from({ length: numPeriods }, (_, i) => {
    const startAge = lifeExpectancy - (i + 1) * 10 + 1;
    return startAge >= 75 ? 100 : 50;
  });
}

export function getNetMonthlyContribution(
  age: number,
  grossMonthlyContribution: number,
  monthlyMortgagePayment: number,
  mortgageEndAge: number,
  familyLoanMonthlyPayment: number,
  familyLoanEndAge: number,
): number {
  let net = grossMonthlyContribution;
  if (monthlyMortgagePayment > 0 && age < mortgageEndAge) {
    net -= monthlyMortgagePayment;
  }
  if (familyLoanMonthlyPayment > 0 && age < familyLoanEndAge) {
    net -= familyLoanMonthlyPayment;
  }
  return Math.round(net * 100) / 100;
}

export function getPeriodAgeRange(
  periodIndex: number,
  lifeExpectancy: number,
): { startAge: number; endAge: number } {
  const endAge = lifeExpectancy - periodIndex * 10;
  const startAge = Math.max(0, endAge - 9);
  return { startAge, endAge };
}

export interface YearDetail {
  age: number;
  total: number;
  savingsAccount: number;
  investments: number;
  accountContribution: number;
  investmentContribution: number;
  expenses: number;
  taxes: number;
  pensionReceived: number;
}

export function simulateDetailedPath(
  params: RetirementParams,
  retirementAge: number,
  monthlyPension: number,
): YearDetail[] {
  const monthlyAccountRate = params.savingsAccountRate / 12 / 100;
  const monthlyInvestmentRate = params.investmentRate / 12 / 100;

  let savingsAccount = Math.max(0, params.initialSavingsAccount);
  let investments = Math.max(0, params.initialInvestments);
  let investmentCostBasis = investments;

  const totalMonths = (params.lifeExpectancy - params.currentAge) * 12;
  const retirementMonth = Math.max(0, (retirementAge - params.currentAge) * 12);

  let savingsGainsThisYear = 0;
  let previousSavingsGains = 0;

  const years: YearDetail[] = [];

  let yearAccountContrib = 0;
  let yearInvestmentContrib = 0;
  let yearExpenses = 0;
  let yearTaxes = 0;
  let yearPension = 0;

  years.push({
    age: params.currentAge,
    total: Math.round((savingsAccount + investments) * 100) / 100,
    savingsAccount: Math.round(savingsAccount * 100) / 100,
    investments: Math.round(investments * 100) / 100,
    accountContribution: 0,
    investmentContribution: 0,
    expenses: 0,
    taxes: 0,
    pensionReceived: 0,
  });

  for (let month = 1; month <= totalMonths; month++) {
    const totalAgeInMonths = params.currentAge * 12 + month - 1;
    const age = Math.floor(totalAgeInMonths / 12);
    const monthInYear = ((month - 1) % 12) + 1;
    const yearNum = Math.ceil(month / 12);
    const isRetired = month > retirementMonth;

    if (monthInYear === 1 && yearNum > 1) {
      previousSavingsGains = savingsGainsThisYear;
      savingsGainsThisYear = 0;
    }

    const accountInterest = savingsAccount * monthlyAccountRate;
    savingsAccount = savingsAccount * (1 + monthlyAccountRate);
    investments = investments * (1 + monthlyInvestmentRate);
    savingsGainsThisYear += accountInterest;

    if (!isRetired) {
      const netContrib = getNetMonthlyContribution(
        age,
        params.monthlyContribution,
        params.monthlyMortgagePayment,
        params.mortgageEndAge,
        params.familyLoanMonthlyPayment,
        params.familyLoanEndAge,
      );

      const periodIndex = getDistributionPeriodIndex(age, params.lifeExpectancy, params.distributionPeriods.length);
      const savingsPct = params.distributionPeriods[periodIndex] ?? 50;

      if (netContrib > 0) {
        const toSavings = netContrib * (savingsPct / 100);
        const toInvestments = netContrib * ((100 - savingsPct) / 100);
        savingsAccount += toSavings;
        investments += toInvestments;
        investmentCostBasis += toInvestments;
        yearAccountContrib += toSavings;
        yearInvestmentContrib += toInvestments;
      }
    } else {
      let monthlyExpenses = age >= params.residencyAge
        ? params.monthlyExpensesInResidency
        : params.monthlyExpensesPreResidency;

      if (age < params.mortgageEndAge && params.monthlyMortgagePayment > 0) {
        monthlyExpenses += params.monthlyMortgagePayment;
      }
      if (age < params.familyLoanEndAge && params.familyLoanMonthlyPayment > 0) {
        monthlyExpenses += params.familyLoanMonthlyPayment;
      }

      const pension = age >= params.pensionStartAge ? monthlyPension : 0;
      const netFlow = pension - monthlyExpenses;

      yearExpenses += monthlyExpenses;
      yearPension += pension;

      if (netFlow >= 0) {
        const periodIndex = getDistributionPeriodIndex(age, params.lifeExpectancy, params.distributionPeriods.length);
        const savingsPct = params.distributionPeriods[periodIndex] ?? 50;
        const toSavings = netFlow * (savingsPct / 100);
        const toInvestments = netFlow * ((100 - savingsPct) / 100);
        savingsAccount += toSavings;
        investments += toInvestments;
        investmentCostBasis += toInvestments;
        yearAccountContrib += toSavings;
        yearInvestmentContrib += toInvestments;
      } else {
        let remaining = -netFlow;

        const periodIndex = getDistributionPeriodIndex(age, params.lifeExpectancy, params.distributionPeriods.length);
        const savingsPct = params.distributionPeriods[periodIndex] ?? 50;
        const usePct = params.withdrawalPct;

        let fromSavings = Math.min(remaining * usePct / 100, Math.max(0, savingsAccount));
        savingsAccount = Math.max(0, savingsAccount - fromSavings);
        remaining -= fromSavings;
        yearAccountContrib -= fromSavings;

        if (remaining > 0.01 && investments > 0.01) {
          const totalValue = investments;
          const costBasisRatio = Math.min(1, investmentCostBasis / totalValue);

          let sellAmount = remaining;
          for (let iter = 0; iter < 10; iter++) {
            const gain = sellAmount * (1 - costBasisRatio);
            const tax = calculateTax(Math.max(0, gain));
            sellAmount = remaining + tax;
          }

          sellAmount = Math.min(sellAmount, totalValue);
          if (sellAmount > 0.01) {
            const actualGain = sellAmount * (1 - costBasisRatio);
            const tax = calculateTax(Math.max(0, actualGain));
            const costBasisSold = sellAmount - actualGain;
            investmentCostBasis = Math.max(0, investmentCostBasis - costBasisSold);
            investments = Math.max(0, investments - sellAmount);
            yearInvestmentContrib -= sellAmount;
            yearTaxes += tax;
            remaining = Math.max(0, remaining - (sellAmount - tax));
          }
        }

        if (remaining > 0.01) {
          const extra = Math.min(remaining, Math.max(0, savingsAccount));
          savingsAccount = Math.max(0, savingsAccount - extra);
          remaining -= extra;
          yearAccountContrib -= extra;
        }
      }
    }

    if (monthInYear === 6 && yearNum > 1 && previousSavingsGains > 0 && savingsAccount > 0.01) {
      const tax = calculateTax(previousSavingsGains);
      const actualTax = Math.min(tax, Math.max(0, savingsAccount));
      savingsAccount = Math.max(0, savingsAccount - actualTax);
      yearTaxes += actualTax;
    }

    if (monthInYear === 12 || month === totalMonths) {
      years.push({
        age,
        total: Math.round((savingsAccount + investments) * 100) / 100,
        savingsAccount: Math.round(savingsAccount * 100) / 100,
        investments: Math.round(investments * 100) / 100,
        accountContribution: Math.round(yearAccountContrib * 100) / 100,
        investmentContribution: Math.round(yearInvestmentContrib * 100) / 100,
        expenses: Math.round(yearExpenses * 100) / 100,
        taxes: Math.round(yearTaxes * 100) / 100,
        pensionReceived: Math.round(yearPension * 100) / 100,
      });

      yearAccountContrib = 0;
      yearInvestmentContrib = 0;
      yearExpenses = 0;
      yearTaxes = 0;
      yearPension = 0;
    }
  }

  return years;
}
