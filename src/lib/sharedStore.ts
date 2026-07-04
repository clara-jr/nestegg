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
