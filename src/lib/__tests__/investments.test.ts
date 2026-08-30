import { describe, it, expect } from 'vitest';
import {
  computePortfolio,
  computeInterest,
  computeExpenses,
  computeCashBalance,
  computeAccountEvolution,
  guessExpenseCategory,
  aggregateByMonth,
  cleanConcept,
  buildConceptCategoryMap,
  resolveExpenseCategory,
} from '../investments';
import type { Movement } from '../bankImports';

let counter = 0;

function mk(partial: Partial<Movement> & Pick<Movement, 'type' | 'amount'>): Movement {
  counter++;
  return {
    id: `test-${counter}`,
    fileId: 'file-1',
    bank: 'trade-republic',
    date: '2024-01-01',
    concept: 'TEST CONCEPT',
    category: undefined,
    ...partial,
  };
}

describe('computePortfolio', () => {
  const movements: Movement[] = [
    mk({ type: 'buy', date: '2024-01-02', concept: 'VWCE', ticker: 'VWCE', amount: -1000, shares: 10, price: 100, fee: -1 }),
    mk({ type: 'buy', date: '2024-02-02', concept: 'VWCE', ticker: 'VWCE', amount: -1100, shares: 10, price: 110 }),
    mk({ type: 'sell', date: '2024-03-02', concept: 'VWCE', ticker: 'VWCE', amount: 600, shares: 5, price: 120 }),
    mk({ type: 'dividend', date: '2024-03-10', concept: 'VWCE', ticker: 'VWCE', amount: 25 }),
    mk({ type: 'fee', date: '2024-03-11', concept: 'CUSTODY FEE', amount: -3 }),
  ];

  it('calcula coste medio, realizado y latente con precio actual', () => {
    const { holdings, summary } = computePortfolio(movements, key =>
      key === 'VWCE' ? 130 : undefined
    );

    expect(holdings.length).toBe(1);
    const h = holdings[0];
    expect(h.shares).toBeCloseTo(15);
    // coste puro de participaciones: 1000 + 1100 = 2100 (la comisión de 1 € de
    // la compra no cuenta); venta: 600 − 105 × 5 → coste restante 1575
    expect(h.investedCost).toBeCloseTo(1575, 2);
    expect(h.avgPrice).toBeCloseTo(105, 2);
    expect(h.realizedPnl).toBeCloseTo(600 - 105 * 5, 2);
    expect(h.unrealizedPnl).toBeCloseTo(15 * 130 - h.investedCost, 2);
    expect(h.dividends).toBeCloseTo(25);
    expect(h.firstBuyDate).toBe('2024-01-02');

    expect(summary.investedCost).toBeCloseTo(h.investedCost, 2);
    expect(summary.currentValue).toBeCloseTo(1950, 2);
    // comisión de la compra (1) + comisión de custodia (3)
    expect(summary.feesAndTaxes).toBeCloseTo(4);
    expect(summary.totalBenefit).toBeCloseTo(
      summary.realized + summary.unrealized + summary.dividends,
      6
    );
  });

  it('usa el precio medio como fallback cuando no hay precio guardado', () => {
    const { holdings } = computePortfolio(movements.slice(0, 2), () => undefined);
    expect(holdings[0].priceSource).toBe('fallback');
    expect(holdings[0].currentPrice).toBeCloseTo(105, 2);
  });

  it('conserva dividendos de posiciones totalmente vendidas', () => {
    const onlyDividend = [
      mk({ type: 'sell', date: '2024-01-05', concept: 'X', ticker: 'X', amount: 500, shares: 10 }),
      mk({ type: 'dividend', date: '2024-02-05', concept: 'X', ticker: 'X', amount: 12 }),
    ];
    const { holdings } = computePortfolio(onlyDividend, () => undefined);
    expect(holdings.length).toBe(1);
    expect(holdings[0].shares).toBe(0);
    expect(holdings[0].dividends).toBeCloseTo(12);
    // ventas sin base de coste registrada cuentan el importe íntegro como realizado
    expect(holdings[0].realizedPnl).toBeCloseTo(500);
    // sin compras registradas no hay fecha de primera compra
    expect(holdings[0].firstBuyDate).toBeUndefined();
  });

  it('contabiliza las comisiones de compra y venta fuera del precio medio', () => {
    const { holdings, summary } = computePortfolio(
      [
        mk({ type: 'buy', date: '2024-01-02', concept: 'SPY', ticker: 'SPY', amount: -1000, shares: 10, price: 100, fee: -1 }),
        mk({ type: 'buy', date: '2024-01-15', concept: 'SPY', ticker: 'SPY', amount: -1200, shares: 10, price: 120 }),
        mk({ type: 'sell', date: '2024-02-02', concept: 'SPY', ticker: 'SPY', amount: 1300, shares: 10, price: 130, fee: -2 }),
      ],
      () => undefined
    );
    const h = holdings[0];
    // Precio medio puro: (1000 + 1200) / 20 = 110, sin comisiones
    expect(h.avgPrice).toBeCloseTo(110, 2);
    expect(h.investedCost).toBeCloseTo(1100, 2);
    // realizado con importe íntegro de la venta: 1300 − 110 × 10
    expect(h.realizedPnl).toBeCloseTo(200, 2);
    expect(summary.feesAndTaxes).toBeCloseTo(3);
    expect(summary.totalBenefit).toBeCloseTo(200, 6);
  });

  it('calcula el valor neto de un depósito a plazo (capital neto, precio=1)', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: -80000 }),
      mk({ type: 'sell', date: '2024-03-15', concept: 'CONST. AHORRO PLAZO', amount: 80000 }),
      mk({ type: 'buy', date: '2024-04-01', concept: 'CONST. AHORRO PLAZO', amount: -250000 }),
      mk({ type: 'sell', date: '2024-06-10', concept: 'CONST. AHORRO PLAZO', amount: 20000 }),
      mk({ type: 'sell', date: '2024-06-10', concept: 'INTERESES PLAZO', amount: 3500 }),
    ];
    const { holdings, summary } = computePortfolio(plazoMovements, () => undefined);
    // Dos plazos: el primero se cerró, el segundo sigue abierto
    expect(holdings.length).toBe(2);
    const closed = holdings.find(h => h.name === 'Plazo Fijo 10-01-2024')!;
    const open = holdings.find(h => h.name === 'Plazo Fijo 01-04-2024')!;
    // Primer plazo: cerrado sin intereses
    expect(closed.shares).toBeCloseTo(0);
    expect(closed.value).toBeCloseTo(0);
    expect(closed.realizedPnl).toBeCloseTo(0);
    expect(closed.dividends).toBeCloseTo(0);
    // Segundo plazo: comprado 250000, vendido 20000, interés 3500
    expect(open.shares).toBeCloseTo(230000);
    expect(open.investedCost).toBeCloseTo(230000);
    expect(open.value).toBeCloseTo(230000);
    // «Recibido» = solo intereses (3500), no la devolución de capital
    expect(open.realizedPnl).toBeCloseTo(3500);
    expect(open.dividends).toBeCloseTo(0);
    expect(summary.currentValue).toBeCloseTo(230000);
  });

  it('plazo fijo: intereses se acumulan y se muestran como Recibido', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: -80000 }),
      mk({ type: 'sell', date: '2024-03-10', concept: 'INTERESES PLAZO', amount: 500 }),
      mk({ type: 'sell', date: '2024-06-10', concept: 'CONST. AHORRO PLAZO', amount: 80000 }),
    ];
    const { holdings } = computePortfolio(plazoMovements, () => undefined);
    expect(holdings.length).toBe(1);
    const h = holdings[0];
    expect(h.name).toBe('Plazo Fijo 10-01-2024');
    // Cerrado: «Recibido» = solo intereses, devolución de capital no suma
    expect(h.shares).toBeCloseTo(0);
    expect(h.realizedPnl).toBeCloseTo(500);
    expect(h.dividends).toBeCloseTo(0);
    expect(h.value).toBeCloseTo(0);
  });

  it('plazo fijo: venta parcial no cierra ni muestra intereses como dividendo', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: -80000 }),
      mk({ type: 'sell', date: '2024-03-10', concept: 'INTERESES PLAZO', amount: 500 }),
      mk({ type: 'sell', date: '2024-06-10', concept: 'CONST. AHORRO PLAZO', amount: 30000 }),
    ];
    const { holdings } = computePortfolio(plazoMovements, () => undefined);
    expect(holdings.length).toBe(1);
    const h = holdings[0];
    // Abierto: capital restante = 50000, intereses pendientes se ven como Recibido
    expect(h.shares).toBeCloseTo(50000);
    expect(h.realizedPnl).toBeCloseTo(500);
    expect(h.dividends).toBeCloseTo(0);
  });

  it('plazos secuenciales: se cierra uno y se abre otro', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: -10000 }),
      mk({ type: 'sell', date: '2024-04-10', concept: 'INTERESES PLAZO', amount: 200 }),
      mk({ type: 'sell', date: '2024-04-10', concept: 'CONST. AHORRO PLAZO', amount: 10000 }),
      mk({ type: 'buy', date: '2024-05-01', concept: 'CONST. AHORRO PLAZO', amount: -20000 }),
    ];
    const { holdings } = computePortfolio(plazoMovements, () => undefined);
    expect(holdings.length).toBe(2);
    const closed = holdings.find(h => h.name === 'Plazo Fijo 10-01-2024')!;
    const open = holdings.find(h => h.name === 'Plazo Fijo 01-05-2024')!;
    // Cerrado: solo intereses (200), no devolución de capital
    expect(closed.realizedPnl).toBeCloseTo(200);
    expect(closed.dividends).toBeCloseTo(0);
    // Abierto: nuevo depósito
    expect(open.shares).toBeCloseTo(20000);
    expect(open.realizedPnl).toBeCloseTo(0);
  });

  it('venta de plazo fijo sin compra previa se ignora', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'sell', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: 80000 }),
    ];
    const { holdings } = computePortfolio(plazoMovements, () => undefined);
    expect(holdings.length).toBe(0);
  });

  it('CANCEL.AHORRO PLAZO se clasifica como venta y reduce el plazo', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: -80000 }),
      mk({ type: 'sell', date: '2024-06-10', concept: 'CANCEL.AHORRO PLAZO', amount: 80000 }),
    ];
    const { holdings } = computePortfolio(plazoMovements, () => undefined);
    // Plazo cerrado sin intereses → sigue apareciendo en Cartera
    expect(holdings.length).toBe(1);
    expect(holdings[0].shares).toBeCloseTo(0);
    expect(holdings[0].realizedPnl).toBeCloseTo(0);
  });

  it('CONSTRUIR MADRID no se asocia a plazo fijo', () => {
    const movements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'Fecha de operación: 11-05-2024 CONSTRUIR MADRID', amount: -500 }),
    ];
    const { holdings } = computePortfolio(movements, () => undefined);
    // No debería asociarse a ningún plazo fijo
    expect(holdings.every(h => h.assetClass !== 'plazo-fijo')).toBe(true);
  });

  it('intereses llegan después del cierre del plazo', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: -80000 }),
      mk({ type: 'sell', date: '2024-06-10', concept: 'CANC. 7521-03-222.934-66 N.I. 1 AHORRO A PLAZO', amount: 80000 }),
      mk({ type: 'sell', date: '2024-06-15', concept: 'INTERESES PLAZO', amount: 1600 }),
    ];
    const { holdings, summary } = computePortfolio(plazoMovements, () => undefined);
    const h = holdings.find(h => h.assetClass === 'plazo-fijo')!;
    expect(h).toBeDefined();
    expect(h.shares).toBeCloseTo(0);
    expect(h.realizedPnl).toBeCloseTo(1600);
    expect(h.totalPnl).toBeCloseTo(1600);
    expect(summary.realized).toBeCloseTo(1600);
    expect(summary.totalBenefit).toBeCloseTo(1600);
  });

  it('plazo fijo: el precio medio y actual son 1 (capital = participaciones)', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: -80000 }),
    ];
    const { holdings } = computePortfolio(plazoMovements, () => undefined);
    const h = holdings.find(h => h.assetClass === 'plazo-fijo')!;
    expect(h.avgPrice).toBeCloseTo(1);
    expect(h.currentPrice).toBeCloseTo(1);
    expect(h.value).toBeCloseTo(80000);
  });

  it('plazo fijo: con TIR y duración, Latente estima la ganancia al vencimiento', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: -10000 }),
      mk({ type: 'sell', date: '2024-03-10', concept: 'INTERESES PLAZO', amount: 100 }),
    ];
    const key = 'plazo-fijo|trade-republic|2024-01-10';
    const { holdings, summary } = computePortfolio(
      plazoMovements,
      () => undefined,
      { [key]: { rate: 4, months: 6 } }
    );
    const h = holdings.find(h => h.assetClass === 'plazo-fijo')!;
    expect(h.plazoRate).toBe(4);
    expect(h.plazoMonths).toBe(6);
    // Ganancia prevista: 10000 × 4 % × 6/12 = 200
    expect(h.plazoProjectedGain).toBeCloseTo(200, 2);
    // Latente = prevista menos intereses ya cobrados; Total = ganancia completa
    expect(h.realizedPnl).toBeCloseTo(100, 2);
    expect(h.unrealizedPnl).toBeCloseTo(100, 2);
    expect(h.totalPnl).toBeCloseTo(200, 2);
    expect(summary.unrealized).toBeCloseTo(100, 2);
    expect(summary.totalBenefit).toBeCloseTo(200, 2);
  });

  it('plazo fijo sin TIR ni duración mantiene el Latente en 0', () => {
    const plazoMovements: Movement[] = [
      mk({ type: 'buy', date: '2024-01-10', concept: 'CONST. AHORRO PLAZO', amount: -10000 }),
    ];
    const { holdings } = computePortfolio(plazoMovements, () => undefined);
    const h = holdings.find(h => h.assetClass === 'plazo-fijo')!;
    expect(h.plazoRate).toBeUndefined();
    expect(h.unrealizedPnl).toBeCloseTo(0);
    expect(h.totalPnl).toBeCloseTo(0);
  });
});

describe('aggregateByMonth y computeInterest', () => {
  const movements: Movement[] = [
    mk({ type: 'interest', date: '2024-01-31', concept: 'Intereses enero', amount: 10 }),
    mk({ type: 'interest', date: '2024-01-15', concept: 'Intereses promo', amount: 5 }),
    mk({ type: 'interest', date: '2024-03-31', concept: 'Intereses marzo', amount: 3 }),
  ];

  it('agrupa por mes en orden cronológico', () => {
    expect(aggregateByMonth(movements)).toEqual([
      { month: '2024-01', total: 15 },
      { month: '2024-03', total: 3 },
    ]);
  });

  it('resume intereses con media mensual sobre el rango completo', () => {
    const summary = computeInterest(movements);
    expect(summary.total).toBeCloseTo(18);
    expect(summary.averageMonthly).toBeCloseTo(18 / 3);
    expect(summary.yearly).toEqual([{ year: '2024', total: 18 }]);
  });

  it('resta la retención (tax) del interés abonado', () => {
    const withTax = [
      mk({ type: 'interest', date: '2024-06-30', concept: 'Intereses junio', amount: 12.34, tax: -0.57 }),
    ];
    const summary = computeInterest(withTax);
    expect(summary.gross).toBeCloseTo(12.34);
    expect(summary.withheld).toBeCloseTo(0.57);
    expect(summary.total).toBeCloseTo(11.77);
    expect(summary.monthly[0].total).toBeCloseTo(11.77);
  });
});

describe('computeCashBalance', () => {
  it('reconstruye el saldo con el importe firmado de los movimientos', () => {
    const movements: Movement[] = [
      mk({ type: 'deposit', amount: 1000 }),
      mk({ type: 'buy', amount: -400 }),
      mk({ type: 'dividend', amount: 25 }),
      mk({ type: 'interest', amount: 6.5 }),
      mk({ type: 'expense', amount: -31.5 }),
      mk({ type: 'transfer', amount: -999 }), // traspaso a inversiones: reduce el saldo
      mk({ type: 'fee', amount: -1 }),
    ];
    expect(computeCashBalance(movements)).toBeCloseTo(1000 - 400 + 25 + 6.5 - 31.5 - 999 - 1);
  });

  it('resta la retención (tax) de intereses y dividendos abonados netos', () => {
    const movements: Movement[] = [
      mk({ type: 'deposit', amount: 1000 }),
      mk({ type: 'interest', amount: 12.34, tax: -0.57 }),
      mk({ type: 'dividend', amount: 50, tax: -5 }),
    ];
    expect(computeCashBalance(movements)).toBeCloseTo(1000 + 12.34 - 0.57 + 50 - 5);
  });

  it('resta las comisiones (fee) cobradas aparte del importe', () => {
    const movements: Movement[] = [
      mk({ type: 'deposit', amount: 4900 }),
      mk({ type: 'buy', amount: -976, fee: -1 }),
      mk({ type: 'buy', amount: -24 }), // sin comisión
      mk({ type: 'sell', amount: 999.96, fee: -1 }),
    ];
    expect(computeCashBalance(movements)).toBeCloseTo(4900 - 976 - 1 - 24 + 999.96 - 1);
  });
});

describe('computeAccountEvolution', () => {
  it('acumula aportaciones netas e intereses mes a mes', () => {
    const movements: Movement[] = [
      mk({ type: 'deposit', date: '2024-01-10', amount: 1000 }),
      mk({ type: 'interest', date: '2024-01-31', amount: 5, tax: -1 }),
      mk({ type: 'withdrawal', date: '2024-02-10', amount: -200 }),
      mk({ type: 'interest', date: '2024-03-31', amount: 3 }),
    ];
    const { evolution, totalContributed, totalInterest } = computeAccountEvolution(movements);

    expect(evolution).toEqual([
      { month: '2024-01', contributed: 1000, interest: 4 },
      { month: '2024-02', contributed: 800, interest: 4 },
      { month: '2024-03', contributed: 800, interest: 7 },
    ]);
    expect(totalContributed).toBe(800);
    expect(totalInterest).toBe(7);
  });

  it('la serie acaba en el saldo en cuenta y separa ingresos de intereses', () => {
    const movements: Movement[] = [
      mk({ type: 'deposit', date: '2024-01-10', amount: 1000 }),
      mk({ type: 'buy', date: '2024-01-15', amount: -400, fee: -1 }),
      mk({ type: 'sell', date: '2024-02-01', amount: 150, tax: -5 }),
      mk({ type: 'dividend', date: '2024-02-10', amount: 10 }),
      mk({ type: 'interest', date: '2024-02-28', amount: 12.34, tax: -0.57 }),
    ];
    const { evolution, totalContributed, totalInterest } = computeAccountEvolution(movements);

    // Compra: salen 401 del efectivo; venta: vuelven 145; dividendo: +10
    expect(evolution).toEqual([
      { month: '2024-01', contributed: 599, interest: 0 },
      { month: '2024-02', contributed: 754, interest: 11.77 },
    ]);

    // Invariante: aportado + intereses reproduce el saldo reconstruido
    expect(totalContributed + totalInterest).toBeCloseTo(computeCashBalance(movements), 6);
    expect(totalContributed).toBeCloseTo(754, 6);
    expect(totalInterest).toBeCloseTo(11.77, 6);
  });

  it('incluye traspasos en la evolución de la cuenta', () => {
    const result = computeAccountEvolution([mk({ type: 'transfer', amount: -100 })]);
    expect(result.evolution).toEqual([{ month: '2024-01', contributed: -100, interest: 0 }]);
    expect(result.totalContributed).toBe(-100);
    expect(result.totalInterest).toBe(0);
  });
});

describe('computeExpenses', () => {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10);
  const oldMonth = new Date(now.getFullYear(), now.getMonth() - 2, 5);

  const movements: Movement[] = [
    mk({ type: 'expense', date: iso(oldMonth), concept: 'MERCADONA', amount: -100, category: 'Alimentación' }),
    mk({ type: 'expense', date: iso(lastMonth), concept: 'NETFLIX', amount: -13.99, category: 'Suscripciones' }),
    mk({ type: 'expense', date: iso(thisMonth), concept: 'GIMNASIO', amount: -40, category: 'Salud y deporte' }),
    mk({ type: 'expense', date: iso(thisMonth), concept: 'DEVOLUCION AMAZON', amount: -25, category: 'Excluido' }),
  ];

  it('excluye la categoría Excluido del cálculo', () => {
    const summary = computeExpenses(movements);
    expect(summary.total).toBeCloseTo(153.99);
    expect(summary.byCategory.map(c => c.category)).not.toContain('Excluido');
  });

  it('calcula media mensual sobre el rango desde el primer gasto hasta el último', () => {
    const summary = computeExpenses(movements);
    expect(summary.monthCount).toBe(3);
    expect(summary.averageMonthly).toBeCloseTo(153.99 / 3);
  });

  it('separa mes actual y anterior', () => {
    const summary = computeExpenses(movements);
    expect(summary.currentMonth).toBeCloseTo(40);
    expect(summary.previousMonth).toBeCloseTo(13.99);
  });

  it('desglosa por categoría ordenado descendentemente', () => {
    const summary = computeExpenses(movements);
    expect(summary.byCategory[0].category).toBe('Alimentación');
    expect(summary.byCategory[0].total).toBeCloseTo(100);
  });
});

describe('guessExpenseCategory', () => {
  it('categoriza por palabras clave ignorando acentos', () => {
    expect(guessExpenseCategory('COMERCIO MERCADONA MADRID')).toBe('Alimentación');
    expect(guessExpenseCategory('NETFLIX.COM SUSCRIPCION')).toBe('Suscripciones');
    expect(guessExpenseCategory('RECIBO IBERDROLA LUZ')).toBe('Suministros e Internet');
    expect(guessExpenseCategory('CABIFY MADRID')).toBe('Transporte');
    expect(guessExpenseCategory('BOOKING.COM HOTEL')).toBe('Viajes');
    expect(guessExpenseCategory('FARMACIA CENTRAL')).toBe('Salud');
    expect(guessExpenseCategory('COMPRA AMAZON.ES')).toBe('Otros');
  });

  it('categoriza conceptos específicos', () => {
    expect(guessExpenseCategory('NUBOIL ENERGIA FACTURA')).toBe('Suministros e Internet');
    expect(guessExpenseCategory('GAS POWER RECIBO')).toBe('Suministros e Internet');
    expect(guessExpenseCategory('DIGI INTERNET')).toBe('Suministros e Internet');
    expect(guessExpenseCategory('KIWOKO COMPRA')).toBe('Animales');
    expect(guessExpenseCategory('DIAGER VET CLINICA')).toBe('Animales');
    expect(guessExpenseCategory('GATTOS COMIDA')).toBe('Animales');
    expect(guessExpenseCategory('CORECDAD. PROP. PASEO EXTREMADURA, 99')).toBe('Vivienda');
    expect(guessExpenseCategory('PELUQUERIA PRINCIPE')).toBe('Peluquería');
    expect(guessExpenseCategory('AYTO MADRID DEPOR')).toBe('Gimnasio');
    expect(guessExpenseCategory('CLINICA ODONTOL')).toBe('Salud');
    expect(guessExpenseCategory('regalo a maria')).toBe('Regalos');
    expect(guessExpenseCategory('Restaurant La Paella')).toBe('Restaurantes y delivery');
    expect(guessExpenseCategory('COREPayPal Europe S.a.r.l. et Cie S.C.A')).toBe('Otros');
    expect(guessExpenseCategory('FARMACIA VADEMECUM')).toBe('Salud');
    expect(guessExpenseCategory('AWS HOSTING')).toBe('Trabajo');
    expect(guessExpenseCategory('CLOUDFLARE CDN')).toBe('Trabajo');
    expect(guessExpenseCategory('ESCROW"."SERVICES')).toBe('Trabajo');
  });

  it('devuelve Otros si no coincide nada', () => {
    expect(guessExpenseCategory('PAGO A FRANQUICIADO XYZ')).toBe('Otros');
  });
});

describe('cleanConcept', () => {
  it('elimina el prefijo de fecha de operación', () => {
    expect(cleanConcept('Fecha de operación: 09-12-2025 MERCADONA')).toBe('MERCADONA');
    expect(cleanConcept('  fecha valor: 09/12/2025 NETFLIX  ')).toBe('NETFLIX');
  });

  it('deja intactos los conceptos sin prefijo', () => {
    expect(cleanConcept('MERCADONA')).toBe('MERCADONA');
  });
});

describe('buildConceptCategoryMap / resolveExpenseCategory', () => {
  it('aprende la categoría de un concepto existente para uno nuevo', () => {
    const existing: Movement[] = [
      mk({ type: 'expense', concept: 'Fecha de operación: 01-01-2025 MERCADONA', category: 'Alimentación', categoryAuto: true }),
    ];
    expect(resolveExpenseCategory('Fecha de operación: 02-02-2025 MERCADONA', existing)).toBe('Alimentación');
  });

  it('las ediciones manuales tienen prioridad sobre las automáticas', () => {
    const existing: Movement[] = [
      mk({ type: 'expense', concept: 'COREXYZ TIENDA', category: 'Otros', categoryAuto: true }),
      mk({ type: 'expense', concept: 'Fecha de operación: 03-03-2025 COREXYZ TIENDA', category: 'Ropa', categoryAuto: false }),
    ];
    const map = buildConceptCategoryMap(existing);
    expect(map.get('COREXYZ TIENDA')).toBe('Ropa');
  });

  it('cae a las palabras clave cuando no hay concepto aprendido', () => {
    expect(resolveExpenseCategory('NETFLIX.COM', [])).toBe('Suscripciones');
  });
});
