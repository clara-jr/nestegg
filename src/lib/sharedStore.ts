import { useState } from 'react';

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

  mortgageAPR: number;
  isNewBuild: boolean;
  reformCosts: number;
  furnitureCosts: number;
  realEstatePercentage: number;
  cushion: number;
  initialSavings: number;
  memberSalaries: number[];
}

let data: SimulatorData = {
  monthlyMortgagePayment: 0,
  mortgageDurationYears: 0,
  baseCost: 0,
  familyLoanAmount: 0,
  familyLoanDurationYears: 0,
  savingsAccountRate: 2,
  investmentRate: 7,
  totalSavings: 0,
  monthlyContribution: 0,
  timeHorizonYears: 30,
  initialSavingsAccount: 0,
  initialInvestments: 0,
  distributionPeriods: [],

  mortgageAPR: 2.9,
  isNewBuild: false,
  reformCosts: 0,
  furnitureCosts: 0,
  realEstatePercentage: 2.5,
  cushion: 0,
  initialSavings: 0,
  memberSalaries: [0],
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

export function useLocalStorage<T>(key: string, initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] {
  const [stored, setStored] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      if (item !== null) return JSON.parse(item);
    } catch {}
    return initial instanceof Function ? initial() : initial;
  });

  const setValue = (value: T | ((prev: T) => T)) => {
    setStored(prev => {
      const next = value instanceof Function ? value(prev) : value;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  return [stored, setValue];
}
