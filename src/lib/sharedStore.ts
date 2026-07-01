type Listener = () => void;

const listeners = new Set<Listener>();

export interface SimulatorData {
  monthlyMortgagePayment: number;
  mortgageDurationYears: number;
  baseCost: number;
  familyLoanAmount: number;
  familyLoanDurationYears: number;
  savingsAccountRate: number;
  investmentRate: number;
  totalSavings: number;
  monthlyContribution: number;
  timeHorizonYears: number;
  initialSavingsAccount: number;
  initialInvestments: number;
  distributionPeriods: number[];
}

let data: SimulatorData = {
  monthlyMortgagePayment: 1500,
  mortgageDurationYears: 30,
  baseCost: 450000,
  familyLoanAmount: 0,
  familyLoanDurationYears: 0,
  savingsAccountRate: 2,
  investmentRate: 7,
  totalSavings: 440000,
  monthlyContribution: 2119,
  timeHorizonYears: 30,
  initialSavingsAccount: 0,
  initialInvestments: 0,
  distributionPeriods: [],
};

export function getSimulatorData(): SimulatorData {
  return data;
}

export function setSimulatorData(newData: Partial<SimulatorData>) {
  data = { ...data, ...newData };
  listeners.forEach(l => l());
}

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
