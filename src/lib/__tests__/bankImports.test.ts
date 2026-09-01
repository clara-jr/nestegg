import { describe, it, expect } from 'vitest';
import {
  parseDelimited,
  parseNumber,
  parseDateToISO,
  parseDateTimeToMinute,
  hashId,
  extractIsin,
  dedupeMovements,
  mergeSplitTrades,
  normalizeStoredMovements,
  reclassifyStockPerkIncome,
  reclassifySignMismatched,
  splitTradeFees,
  movementSignature,
  detectMyInvestorFormat,
  parseTradeRepublic,
  parseMyInvestorAccount,
  parseMyInvestorFunds,
  parseCaixaBank,
  parseSantander,
  parseBankMatrix,
  parsePayPal,
  paypalDuplicateIds,
} from '../bankImports';
import type { Movement } from '../bankImports';
import { computeCashBalance, computeAccountEvolution } from '../investments';

describe('parseNumber', () => {
  it('parsea decimales con coma (formato español)', () => {
    expect(parseNumber('1.234,56')).toBeCloseTo(1234.56);
    expect(parseNumber('-12,34')).toBe(-12.34);
    expect(parseNumber('0,0245')).toBeCloseTo(0.0245);
    expect(parseNumber('112,24')).toBeCloseTo(112.24);
  });

  it('parsea decimales con punto y miles con coma', () => {
    expect(parseNumber('1234.56')).toBeCloseTo(1234.56);
    expect(parseNumber('1,234.56')).toBeCloseTo(1234.56);
  });

  it('trata puntos de miles correctamente', () => {
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber('-1.058,00')).toBeCloseTo(-1058);
  });

  it('ignora símbolos de moneda y espacios', () => {
    expect(parseNumber('€ 99,90')).toBeCloseTo(99.9);
    expect(parseNumber('1 500,00 EUR')).toBe(1500);
  });

  it('soporta negativos entre paréntesis y sufijo', () => {
    expect(parseNumber('(5,00)')).toBe(-5);
    expect(parseNumber('12-')).toBe(-12);
  });

  it('devuelve undefined para valores vacíos o no numéricos', () => {
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('--')).toBeUndefined();
    expect(parseNumber(null)).toBeUndefined();
    expect(parseNumber('N/A')).toBeUndefined();
  });
});

describe('parseDateToISO', () => {
  it('soporta ISO y formatos europeos', () => {
    expect(parseDateToISO('2024-03-05')).toBe('2024-03-05');
    expect(parseDateToISO('05/03/2024')).toBe('2024-03-05');
    expect(parseDateToISO('05.03.24')).toBe('2024-03-05');
    expect(parseDateToISO('5-3-2024 14:32')).toBe('2024-03-05');
    expect(parseDateToISO('2024/03/05 14:32:11 UTC')).toBe('2024-03-05');
  });

  it('soporta números de serie de Excel', () => {
    const expected = new Date(Math.round((45356 - 25569) * 86400000)).toISOString().slice(0, 10);
    expect(parseDateToISO('45356')).toBe(expected);
  });

  it('devuelve undefined si no hay fecha', () => {
    expect(parseDateToISO('')).toBeUndefined();
    expect(parseDateToISO('COMPRA')).toBeUndefined();
  });
});

describe('parseDateTimeToMinute', () => {
  it('normaliza datetimes ISO y europeos a minuto', () => {
    expect(parseDateTimeToMinute('2024-07-15T08:16:32.680Z')).toBe('2024-07-15T08:16');
    expect(parseDateTimeToMinute('2024-03-05 14:32:11 UTC')).toBe('2024-03-05T14:32');
    expect(parseDateTimeToMinute('2024-03-05T14:32')).toBe('2024-03-05T14:32');
  });

  it('devuelve undefined para valores sin hora o vacíos', () => {
    expect(parseDateTimeToMinute('2024-03-05')).toBeUndefined();
    expect(parseDateTimeToMinute('')).toBeUndefined();
  });
});

describe('hashId y extractIsin', () => {
  it('genera ids estables', () => {
    expect(hashId('trade-republic|a|b|c')).toBe(hashId('trade-republic|a|b|c'));
    expect(hashId('x')).not.toBe(hashId('y'));
  });

  it('extrae ISIN de un texto libre', () => {
    expect(extractIsin('COMPRA VWCE ACC IE00BK5BQT80 XETRA')).toBe('IE00BK5BQT80');
    expect(extractIsin('sin isin')).toBeUndefined();
  });
});

const TR_CSV = `datetime;date;account_type;category;type;asset_class;name;symbol;shares;price;amount;fee;tax;currency
2024-03-05T14:32:11 UTC;2024-03-05;SECURITIES ACCOUNT;ETF;BUY;ETF;Vanguard FTSE All-World;VWCE;"0,0245";"112,24";"-2,75";"0,00";"";EUR
2024-03-06T02:00:00 UTC;2024-03-06;CASH;;INTEREST;;Interest payment;;;;"12,34";"";"";EUR
2024-03-07T18:20:00 UTC;2024-03-07;CASH;;CARD PAYMENT;;MERCADONA MADRID;;;;"-45,20";"";EUR`;

describe('parseTradeRepublic', () => {
  const result = parseTradeRepublic(parseDelimited(TR_CSV));

  it('detecta compras con participaciones, precio e importe', () => {
    expect(result.movements.length).toBe(3);
    const buy = result.movements[0];
    expect(buy.type).toBe('buy');
    expect(buy.date).toBe('2024-03-05');
    expect(buy.ticker).toBe('VWCE');
    expect(buy.shares).toBeCloseTo(0.0245);
    expect(buy.price).toBeCloseTo(112.24);
    expect(buy.amount).toBeCloseTo(-2.75);
    expect(buy.assetClass).toBe('ETF');
  });

  it('clasifica intereses y pagos con tarjeta', () => {
    expect(result.movements[1].type).toBe('interest');
    expect(result.movements[1].amount).toBeCloseTo(12.34);
    expect(result.movements[2].type).toBe('expense');
    expect(result.movements[2].amount).toBeCloseTo(-45.2);
  });

  it('genera ids estables aunque el fichero traiga filas extra al principio', () => {
    const shifted = parseTradeRepublic(parseDelimited(`basura;columnas\n${TR_CSV}`));
    expect(shifted.movements.map(m => m.id)).toEqual(result.movements.map(m => m.id));
  });

  it('re-subir el mismo fichero produce las mismas firmas (sin duplicados)', () => {
    const second = parseTradeRepublic(parseDelimited(TR_CSV));
    const merged = dedupeMovements([...result.movements, ...second.movements]);
    expect(merged.length).toBe(3);
  });

  it('clasifica por la columna category cuando type viene vacío', () => {
    const matrix = parseDelimited(
      'datetime;date;account_type;category;type;asset_class;name;symbol;shares;price;amount;fee;tax;currency\n' +
        '2024-05-01T00:00:00 UTC;2024-05-01;CASH;INTEREST;;Interest on cash balance;;;;;"5,00";"";"-0,95";EUR'
    );
    const parsed = parseTradeRepublic(matrix);
    expect(parsed.movements.length).toBe(1);
    expect(parsed.movements[0].type).toBe('interest');
    expect(parsed.movements[0].tax).toBeCloseTo(-0.95);
  });

  it('clasifica STOCKPERK como regalo/promoción, no como ingreso', () => {
    const matrix = parseDelimited(
      'datetime;date;account_type;category;type;asset_class;name;symbol;shares;price;amount;fee;tax;currency\n' +
        '2024-07-15T15:18:52.855545Z;2024-07-15;CASH;STOCKPERK;STOCKPERK;STOCK;Amazon.com;US0231351067;;;9,69;;EUR'
    );
    const parsed = parseTradeRepublic(matrix);
    expect(parsed.movements.length).toBe(1);
    expect(parsed.movements[0].type).toBe('perk');
  });

  it('mapea tipos CUSTOMER_INBOUND/CUSTOMER_OUTBOUND y variantes con guion bajo', () => {
    const matrix = parseDelimited(
      'datetime;date;account_type;category;type;asset_class;name;symbol;shares;price;amount;fee;tax;currency\n' +
        '2024-05-01T09:00:00 UTC;2024-05-01;CASH;;CUSTOMER_INBOUND;;;;;;"500,00";"";"";EUR\n' +
        '2024-05-02T09:00:00 UTC;2024-05-02;CASH;;CUSTOMER_OUTBOUND;;;;;;"-200,00";"";"";EUR\n' +
        '2024-05-03T09:00:00 UTC;2024-05-03;CASH;;CARD_PAYMENT;;;;;;"12,00";"";"";\n' +
        '2024-05-04T09:00:00 UTC;2024-05-04;CASH;;QUARTERLY TAX REPORT;;;;;;"-3,10";"";""'
    );
    const parsed = parseTradeRepublic(matrix);
    expect(parsed.movements.map(m => m.type)).toEqual([
      'transfer',
      'withdrawal',
      'expense',
      'tax',
    ]);
  });
});

const MI_ACCOUNT = `Fecha operación\tFecha valor\tTipo de operación\tConcepto\tDivisa\tImporte
01/02/2024\t05/02/2024\tCompra de acciones/ETF\tVWCE ACC IE00BK5BQT80\tEUR\t-500,00
01/02/2024\t05/02/2024\tVenta de acciones/ETF\tSPY MSCI WORLD IE00BJ0KDQ92\tEUR\t300,50
15/02/2024\t\tIntereses Cuenta Remunerada\t\tEUR\t2,15
20/02/2024\t\tTraspaso\tTraspaso entre fondos\tEUR\t0,00`;

describe('parseMyInvestorAccount', () => {
  const matrix = parseDelimited(MI_ACCOUNT, '\t');
  const result = parseMyInvestorAccount(matrix);

  it('detecta el formato de cuenta', () => {
    expect(detectMyInvestorFormat(matrix)).toBe('account');
  });

  it('mapea compra, venta e intereses', () => {
    expect(result.movements.length).toBe(4);
    const buy = result.movements[0];
    expect(buy.type).toBe('buy');
    expect(buy.amount).toBeCloseTo(-500);
    expect(buy.isin).toBe('IE00BK5BQT80');
    expect(result.movements[1].type).toBe('sell');
    expect(result.movements[2].type).toBe('interest');
    expect(result.movements[3].type).toBe('transfer');
  });

  it('clasifica suscripciones IIC como transfer (no buy) para evitar doble conteo', () => {
    const iicMatrix = parseDelimited(
      'Fecha operación\tFecha valor\tTipo de operación\tConcepto\tDivisa\tImporte\n' +
      '01/03/2024\t05/03/2024\tSuscripción IIC\tSUSCRIPCION IIC FONDO TEST\tEUR\t-1.058,00\n' +
      '15/04/2024\t19/04/2024\tReembolso IIC\tREEMBOLSO IIC FONDO TEST\tEUR\t1.100,00'
    );
    const result = parseMyInvestorAccount(iicMatrix);
    expect(result.movements.length).toBe(2);
    expect(result.movements[0].type).toBe('transfer');
    expect(result.movements[1].type).toBe('transfer');
  });
});

const MI_FUNDS = [
  ['Fechas', '', 'Operación', 'Mercado', 'Operación', 'ISIN', 'Valor', 'Títulos/NOMINAL', 'Divisa', 'Precio Neto', 'Importe neto'],
  ['Operación', 'Liquidación', '', '', '', '', '', '', '', '', ''],
  ['01/03/2024', '05/03/2024', 'SUSCRIPCIÓN', 'BME', 'FONDO TEST FI CLASE AHORRO', 'ES0173377016', 'FONDO TEST FI CLASE AHORRO', '100', 'EUR', '10,58', '-1.058,00'],
  ['15/04/2024', '19/04/2024', 'REEMBOLSO TOTAL', 'BME', 'FONDO TEST FI CLASE AHORRO', 'ES0173377016', 'FONDO TEST FI CLASE AHORRO', '100', 'EUR', '11,00', '1.100,00'],
];

describe('parseMyInvestorFunds', () => {
  it('detecta el formato de fondos por la cabecera ISIN', () => {
    expect(detectMyInvestorFormat(MI_FUNDS as string[][])).toBe('funds');
  });

  it('mapea suscripciones y reembolsos con ISIN, títulos y precio', () => {
    const result = parseMyInvestorFunds(MI_FUNDS as string[][]);
    expect(result.movements.length).toBe(2);

    const buy = result.movements[0];
    expect(buy.type).toBe('buy');
    expect(buy.date).toBe('2024-03-01');
    expect(buy.isin).toBe('ES0173377016');
    expect(buy.shares).toBe(100);
    expect(buy.price).toBeCloseTo(10.58);
    expect(buy.amount).toBeCloseTo(-1058);
    expect(buy.concept).toContain('FONDO TEST');

    const sell = result.movements[1];
    expect(sell.type).toBe('sell');
    expect(sell.amount).toBeCloseTo(1100);
  });
});

const CAIXA_CSV = `Fecha Valor;Fecha Contable;Concepto;Importe
01/04/2024;01/04/2024;NOMINA ABRIL;1.800,00
02/04/2024;02/04/2024;INTERESES LIQUIDADOS CUENTA;0,85
03/04/2024;03/04/2024;COMERCIO MERCADONA MADRID;-45,30
04/04/2024;04/04/2024;TRASPASO ENTRE CUENTAS PROPIAS;-200,00
05/04/2024;05/04/2024;RECIBO LUZ ENDESA;-75,10`;

describe('parseCaixaBank', () => {
  const result = parseCaixaBank(parseDelimited(CAIXA_CSV));

  it('clasifica por palabras clave del concepto', () => {
    expect(result.movements.map(m => m.type)).toEqual([
      'income',
      'interest',
      'expense',
      'transfer',
      'expense',
    ]);
  });

  it('parsea importes con separador de miles español', () => {
    expect(result.movements[0].amount).toBe(1800);
    expect(result.movements[2].amount).toBeCloseTo(-45.3);
  });

  it('clasifica IRPF MOD, IVA MOD y TGSS como Impuesto en vez de Gasto', () => {
    const csv = [
      'fecha;concepto;importe',
      '01/03/2024;PAGO IRPF MOD;50,00',
      '02/03/2024;Cargo I.V.A. MOD;30,00',
      '03/03/2024;CUOTA TGSS;200,00',
    ].join('\n');
    const parsed = parseCaixaBank(parseDelimited(csv));
    const taxes = parsed.movements
      .filter(m => m.type === 'tax')
      .map(m => m.concept);
    expect(taxes).toEqual(['PAGO IRPF MOD', 'Cargo I.V.A. MOD', 'CUOTA TGSS']);
    expect(parsed.movements.every(m => m.type === 'tax')).toBe(true);
  });

  it('asigna el banco correcto', () => {
    for (const m of result.movements) expect(m.bank).toBe('caixabank');
  });

  it('importa el formato XLS con cabeceras Fecha/Fecha valor/Movimiento/Más datos', () => {
    const rows: string[][] = [
      ['Movimientos de la cuenta', 'Importes expresados en euros'],
      ['', ''],
      ['Fecha', 'Fecha valor', 'Movimiento', 'Más datos', 'Importe', 'Saldo'],
      ['2026-08-30', '2026-08-30', 'FARMACIA P.EXTREM', 'Fecha de operación: 28-08-2026', '-0,41', '4284,14'],
      ['2026-08-28', '2026-08-28', 'DIGI SPAIN TEL', 'Recibos varios', '-20,55', '4284,55'],
    ];
    const parsed = parseCaixaBank(rows);

    expect(parsed.movements.length).toBe(2);
    expect(parsed.skipped).toBe(0);

    const [farmacia, digi] = parsed.movements;
    expect(farmacia.type).toBe('expense');
    expect(farmacia.amount).toBeCloseTo(-0.41);
    expect(farmacia.balance).toBeCloseTo(4284.14);
    expect(farmacia.concept).toBe('FARMACIA P.EXTREM');
    expect(farmacia.date).toBe('2026-08-30');
    expect(farmacia.bank).toBe('caixabank');

    expect(digi.type).toBe('expense');
    expect(digi.amount).toBeCloseTo(-20.55);
    expect(digi.balance).toBeCloseTo(4284.55);
    expect(digi.concept).toBe('DIGI SPAIN TEL');
    expect(digi.date).toBe('2026-08-28');
  });
});

describe('parseSantander', () => {
  it('importa el ejemplo del extracto del usuario', () => {
    const rows: string[][] = [
      ['Fecha operación', 'Fecha valor', 'Concepto', 'Importe', 'Saldo', 'Divisa'],
      ['28/08/2026', '28/08/2026', 'PAGO MOVIL EN IKEA ALCORCON H, ROSAL, EL ES, TARJ. :*037123', '-29,99€', '3.540,68€', 'EUR'],
      ['28/08/2026', '28/08/2026', 'COMPRA EN ALCAMPO GASOLIN, FUENLABRADA ES, TARJ. :*037123', '-53,70€', '3.570,67€', 'EUR'],
      ['28/08/2026', '28/08/2026', 'TRANSFERENCIA DE BIPI MOBILITY S.L., CONCEPTO ABONO NOMINA 08 2026.', '1.399,65€', '3.624,37€', 'EUR'],
    ];
    const result = parseSantander(rows);

    expect(result.movements.length).toBe(3);
    expect(result.skipped).toBe(0);

    const [ikea, gasolina, nomina] = result.movements;
    expect(ikea.type).toBe('expense');
    expect(ikea.amount).toBeCloseTo(-29.99);
    expect(ikea.balance).toBeCloseTo(3540.68);
    expect(ikea.date).toBe('2026-08-28');
    expect(ikea.bank).toBe('santander');

    expect(gasolina.type).toBe('expense');
    expect(gasolina.amount).toBeCloseTo(-53.7);
    expect(gasolina.balance).toBeCloseTo(3570.67);

    expect(nomina.type).toBe('income');
    expect(nomina.amount).toBeCloseTo(1399.65);
    expect(nomina.balance).toBeCloseTo(3624.37);
  });

  it('usa FECHA VALOR como referencia cuando no hay FECHA OPERACION', () => {
    const rows: string[][] = [
      ['Fecha valor', 'Concepto', 'Importe', 'Saldo'],
      ['05/03/2024', 'RECIBO LUZ ENDESA', '-75,10', '100,00'],
    ];
    const result = parseSantander(rows);
    expect(result.movements.length).toBe(1);
    expect(result.movements[0].date).toBe('2024-03-05');
  });

  it('ignora el bloque previo del extracto (cuenta, titular, sección Movimientos)', () => {
    // Estructura real del XLSX de Santander: metadatos y una cabecera de
    // sección «Movimientos» antes de la fila con las columnas.
    const rows: string[][] = [
      ['', '', 'Cuenta', 'Fecha'],
      ['', '', '', '30/08/2026 | 18:35:57'],
      ['', '', 'Titular', 'Saldo'],
      ['', '', '', '5.540,68€ EUR'],
      [],
      ['Movimientos'],
      [],
      ['Fecha operación', 'Fecha valor', 'Concepto', 'Importe', 'Saldo', 'Divisa'],
      ['28/08/2026', '28/08/2026', 'PAGO MOVIL EN IKEA ALCORCON H, ROSAL, EL ES, TARJ. :*037682', '-29,99€', '5.540,68€', 'EUR'],
      ['28/08/2026', '28/08/2026', 'TRANSFERENCIA DE BIPI MOBILITY S.L., CONCEPTO ABONO NOMINA 08 2026.', '2.399,65€', '5.624,37€', 'EUR'],
    ];
    const result = parseSantander(rows);
    expect(result.skipped).toBe(0);
    expect(result.movements.length).toBe(2);
    expect(result.movements[0].type).toBe('expense');
    expect(result.movements[0].bank).toBe('santander');
    expect(result.movements[1].type).toBe('income');
  });
});

describe('reclassifySignMismatched', () => {
  const base: Movement = {
    id: 'a',
    fileId: 'f',
    bank: 'santander',
    date: '2026-08-28',
    type: 'expense',
    amount: 42,
    concept: 'REEMBOLSO',
  };

  it('convierte gastos con importe positivo en devoluciones', () => {
    const out = reclassifySignMismatched([{ ...base, type: 'expense' }]);
    expect(out[0].type).toBe('refund');
  });

  it('convierte devoluciones con importe negativo en gastos', () => {
    const out = reclassifySignMismatched([{ ...base, type: 'refund', amount: -42 }]);
    expect(out[0].type).toBe('expense');
  });

  it('deja intactos los movimientos con signo coherente', () => {
    const coherent: Movement[] = [
      { ...base, type: 'expense', amount: -42 },
      { ...base, type: 'refund', amount: 42 },
      { ...base, type: 'income', amount: 42 },
    ];
    expect(reclassifySignMismatched(coherent).map(m => m.type)).toEqual(['expense', 'refund', 'income']);
  });

  it('normalizeStoredMovements corrige gastos positivos y deduplica', () => {
    const positiveExpense: Movement = { ...base, type: 'expense', concept: 'CARD REFUND 123', amount: 10 };
    const duplicated: Movement = { ...positiveExpense, id: 'b', type: 'refund' };
    const out = normalizeStoredMovements([positiveExpense, duplicated]);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('refund');
  });
});

describe('parseTradeRepublic (reembolsos de tarjeta)', () => {
  it('clasifica un reembolso positivo de tarjeta como refund, no como gasto', () => {
    const matrix = parseDelimited(
      'datetime;date;account_type;category;type;asset_class;name;symbol;shares;price;amount;fee;tax;currency\n' +
        '2024-05-03T09:00:00 UTC;2024-05-03;CASH;CARD REFUND;CARD REFUND;;CARD REFUND;;;;"45,20";"";"";'
    );
    const parsed = parseTradeRepublic(matrix);
    expect(parsed.movements.length).toBe(1);
    expect(parsed.movements[0].type).toBe('refund');
  });

  it('parseBankMatrix corrige gastos positivos que el clasificador haya tipado como expense', () => {
    const matrix = parseDelimited(
      'datetime;date;account_type;category;type;asset_class;name;symbol;shares;price;amount;fee;tax;currency\n' +
        '2024-05-03T09:00:00 UTC;2024-05-03;CASH;CARD PAYMENT;CARD PAYMENT;;CARD PAYMENT;;;;"12,00";"";"";'
    );
    const parsed = parseBankMatrix('trade-republic', 'x.csv', matrix);
    expect(parsed.movements.length).toBe(1);
    expect(parsed.movements[0].type).toBe('refund');
    expect(parsed.movements[0].amount).toBeCloseTo(12);
  });
});

describe('dedupeMovements', () => {
  const base: Movement = {
    id: 'a',
    fileId: 'f1',
    bank: 'caixabank',
    date: '2024-04-03',
    type: 'expense',
    concept: 'COMERCIO MERCADONA',
    amount: -45.3,
  };

  it('elimina movimientos con la misma firma aunque el id difiera', () => {
    const duplicate: Movement = { ...base, id: 'b', fileId: 'f2' };
    const distinct: Movement = { ...base, id: 'c', amount: -10 };
    const merged = dedupeMovements([base, duplicate, distinct]);
    expect(merged.length).toBe(2);
    expect(merged[0].id).toBe('a'); // conserva el primero (con sus ediciones)
  });

  it('distingue repetidos del mismo día si el saldo difiere', () => {
    const first: Movement = { ...base, balance: 1000 };
    const second: Movement = { ...base, id: 'b', balance: 954.7 };
    expect(movementSignature(first)).not.toBe(movementSignature(second));
    expect(dedupeMovements([first, second]).length).toBe(2);
  });
});

describe('mergeSplitTrades', () => {
  let seq = 0;
  function buy(partial: Partial<Movement>): Movement {
    seq++;
    return {
      id: `m${seq}`,
      fileId: 'f1',
      bank: 'trade-republic',
      date: '2024-07-15',
      type: 'buy',
      concept: 'VWCE',
      ticker: 'VWCE',
      amount: -1000,
      ...partial,
    };
  }

  it('fusiona compras del mismo producto con el mismo minuto', () => {
    const merged = mergeSplitTrades([
      buy({ datetime: '2024-07-15T08:16', shares: 32, amount: -976, fee: -1 }),
      buy({ datetime: '2024-07-15T08:16', shares: 0.786885, amount: -24 }),
      buy({ datetime: '2024-07-15T09:00', shares: 1, amount: -30.5 }), // otra orden distinta
    ]);
    expect(merged.length).toBe(2);
    const fused = merged.find(m => m.shares === 32.786885)!;
    expect(fused).toBeDefined();
    expect(fused.amount).toBeCloseTo(-1000);
    expect(fused.fee).toBeCloseTo(1);
    expect(fused.price).toBeCloseTo(1000 / 32.786885);
  });

  it('no fusiona compras de productos distintos en el mismo minuto', () => {
    const merged = mergeSplitTrades([
      buy({ datetime: '2024-07-15T08:16', ticker: 'VWCE', shares: 2, amount: -60 }),
      buy({ datetime: '2024-07-15T08:16', ticker: 'SPY', concept: 'SPY', shares: 3, amount: -90 }),
    ]);
    expect(merged.length).toBe(2);
  });

  it('fusiona ventas partidas del mismo producto y minuto conservando el signo', () => {
    const merged = mergeSplitTrades([
      buy({ type: 'sell', datetime: '2025-03-03T17:53', shares: -0.816979, amount: 5.96 }),
      buy({ type: 'sell', datetime: '2025-03-03T17:53', shares: -137, amount: 999.96, fee: -1 }),
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].shares).toBeCloseTo(-137.816979);
    expect(merged[0].amount).toBeCloseTo(1005.92);
    expect(merged[0].price).toBeCloseTo(1005.92 / 137.816979);
    expect(merged[0].fee).toBeCloseTo(1);
  });

  it('sin hora, fusiona solo con el patrón entero + decimal del mismo día', () => {
    const split = mergeSplitTrades([
      buy({ date: '2024-07-15', shares: 32, amount: -976 }),
      buy({ date: '2024-07-15', shares: 0.786885, amount: -24 }),
    ]);
    expect(split.length).toBe(1);

    const legit = mergeSplitTrades([
      buy({ date: '2024-07-15', shares: 3, amount: -90 }),
      buy({ date: '2024-07-15', shares: 2, amount: -60 }), // dos compras legítimas enteras
    ]);
    expect(legit.length).toBe(2);
  });

  it('deja intactas las órdenes que no forman parte de una división', () => {
    const movements = [
      buy({ datetime: '2024-07-15T08:16', shares: 5, amount: -150 }),
      buy({ type: 'sell', amount: 90, shares: 3 }),
    ];
    const merged = mergeSplitTrades(movements);
    expect(merged).toEqual(movements);
  });
});

describe('reclassifyStockPerkIncome', () => {
  it('convierte ingresos antiguos vinculados a un valor sin participaciones en perks', () => {
    const legacyPerk: Movement = {
      id: 'a',
      fileId: 'f',
      bank: 'trade-republic',
      date: '2024-07-15',
      type: 'income',
      concept: 'Amazon.com',
      ticker: 'AMZN',
      isin: 'US0231351067',
      amount: 9.69,
    };
    const gpayTopUp: Movement = {
      id: 'b',
      fileId: 'f',
      bank: 'trade-republic',
      date: '2024-07-10',
      type: 'income',
      concept: 'Google Pay Top up',
      amount: 100,
    };
    const nominaCaixa: Movement = {
      id: 'c',
      fileId: 'f',
      bank: 'caixabank',
      date: '2024-07-01',
      type: 'income',
      concept: 'NOMINA JULIO',
      ticker: 'X',
      amount: 1800,
    };
    const result = reclassifyStockPerkIncome([legacyPerk, gpayTopUp, nominaCaixa]);
    expect(result.map(m => m.type)).toEqual(['perk', 'income', 'income']);
  });
});

describe('splitTradeFees', () => {
  let seq = 0;
  function trade(partial: Partial<Movement>): Movement {
    seq++;
    return {
      id: `t${seq}`,
      fileId: 'f1',
      bank: 'trade-republic',
      date: '2024-07-15',
      type: 'buy',
      concept: 'VWCE',
      ticker: 'VWCE',
      amount: -1000,
      ...partial,
    };
  }

  it('separa la comisión en un movimiento propio vinculado a la orden', () => {
    const parent = trade({ shares: 10, price: 100, fee: -1 });
    const out = splitTradeFees([parent]);
    expect(out.length).toBe(2);

    const tradeRow = out[0];
    expect(tradeRow.type).toBe('buy');
    expect(tradeRow.amount).toBeCloseTo(-1000);
    expect(tradeRow.fee).toBeUndefined(); // la orden ya no arrastra la comisión

    const feeRow = out[1];
    expect(feeRow.type).toBe('fee');
    expect(feeRow.amount).toBeCloseTo(-1);
    expect(feeRow.concept).toContain('VWCE');
    expect(feeRow.ticker).toBe('VWCE');
    expect(feeRow.referenceId).toBe(parent.id);
    expect(feeRow.shares).toBeUndefined();
  });

  it('deja intactas las órdenes sin comisión y los movimientos que no son órdenes', () => {
    const plainBuy = trade({ shares: 5 });
    const dividend = trade({ type: 'dividend', concept: 'Dividendo', amount: 25, fee: -0.5 });
    const out = splitTradeFees([plainBuy, dividend]);
    expect(out).toEqual([plainBuy, dividend]);
  });

  it('es idempotente y preserva el saldo reconstruido', () => {
    const movements = [
      trade({ date: '2024-07-15', shares: 10, price: 100, fee: -1 }),
      trade({ date: '2024-08-01', type: 'sell', shares: -4, amount: 420, fee: -1 }),
      trade({ date: '2024-08-02', type: 'transfer', amount: 2000 }),
    ];
    const once = normalizeStoredMovements(movements);
    expect(once.filter(m => m.type === 'fee').length).toBe(2);
    const twice = normalizeStoredMovements(once);
    expect(twice.length).toBe(once.length); // re-normalizar no duplica comisiones
    expect(computeCashBalance(twice)).toBeCloseTo(computeCashBalance(movements), 6);
  });
});

describe('normalizeStoredMovements', () => {
  it('reclasifica el perk heredado y lo deduplica contra su versión ya migrada', () => {
    const legacy: Movement = {
      id: 'old',
      fileId: 'f1',
      bank: 'trade-republic',
      date: '2024-07-15',
      type: 'income',
      concept: 'Amazon.com',
      ticker: 'AMZN',
      isin: 'US0231351067',
      amount: 9.69,
    };
    const fresh: Movement = { ...legacy, id: 'new', type: 'perk' };
    const out = normalizeStoredMovements([legacy, fresh]);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('perk');
  });

  it('genera las comisiones tras fusionar órdenes partidas (una sola por orden)', () => {
    const parts = [
      { id: 'p1', fileId: 'f1', bank: 'trade-republic' as const, date: '2024-07-15', datetime: '2024-07-15T08:16', type: 'buy' as const, concept: 'VWCE', ticker: 'VWCE', shares: 32, amount: -976, fee: -1 },
      { id: 'p2', fileId: 'f1', bank: 'trade-republic' as const, date: '2024-07-15', datetime: '2024-07-15T08:16', type: 'buy' as const, concept: 'VWCE', ticker: 'VWCE', shares: 0.786885, amount: -24 },
    ];
    const out = normalizeStoredMovements(parts);
    // orden fusionado + una única comisión de 1 € vinculada al fusionado
    expect(out.map(m => m.type)).toEqual(['buy', 'fee']);
    const fused = out[0];
    expect(fused.shares).toBeCloseTo(32.786885);
    expect(fused.fee).toBeUndefined();
    expect(out[1].amount).toBeCloseTo(-1);
    expect(out[1].referenceId).toBe(fused.id);
  });
});

const PAYPAL_CSV = `Fecha\tHora\tZona horaria\tDescripción\tDivisa\tBruto \tComisión \tNeto\tSaldo\tId. de transacción\tCorreo electrónico del remitente\tNombre\tNombre del banco\tCuenta bancaria\tImporte de envío y manipulación\tImpuesto de ventas\tId. de factura\tId. de referencia de trans.
31/8/2023\t11:44:49\tEurope/Berlin\tPago con Pago exprés\tEUR\t-28,00\t0,00\t-28,00\t-28,00\t86H83599N7996272T\tinfo@organicup.dk\tAllMatters ApS\t\t\t4,00\t0,00\tc41511860666713.1\tB-5VS52241EX581491L
31/8/2023\t11:44:49\tEurope/Berlin\tConversión de divisas general\tEUR\t28,00\t0,00\t28,00\t0,00\t24H5866269833882B\t\t\t\t\t4,00\t0,00\tc41511860666713.1\t86H83599N7996272T
3/9/2023\t03:20:51\tEurope/Berlin\tReembolso de pago\tEUR\t92,88\t0,00\t92,88\t92,88\t6YF886265D8055346\tpaypalrow@booking.com\tBooking.com BV\t\t\t0,00\t0,00\t[}sc9DCS4FL!;?k.Y8e?\t0XX47519YG5042718
3/9/2023\t03:20:51\tEurope/Berlin\tConversión de divisas general\tEUR\t-92,88\t0,00\t-92,88\t0,00\t4CA66448HW7933643\t\t\t\t\t0,00\t0,00\t[}sc9DCS4FL!;?k.Y8e?\t0XX47519YG5042718`;

describe('parsePayPal', () => {
  const result = parsePayPal(parseDelimited(PAYPAL_CSV));

  it('filtra las conversiones de divisas internas', () => {
    expect(result.movements.length).toBe(2);
    expect(result.skipped).toBe(2);
  });

  it('clasifica pagos como gasto y reembolsos como devolución', () => {
    expect(result.movements.map(m => m.type)).toEqual(['expense', 'refund']);
  });

  it('parsea fechas, horas y bruto en formato español', () => {
    const [pago, reembolso] = result.movements;
    expect(pago.date).toBe('2023-08-31');
    expect(pago.datetime).toBe('2023-08-31T11:44');
    expect(pago.amount).toBeCloseTo(-28);
    expect(pago.balance).toBeCloseTo(-28);
    expect(reembolso.date).toBe('2023-09-03');
    expect(reembolso.datetime).toBe('2023-09-03T03:20');
    expect(reembolso.amount).toBeCloseTo(92.88);
    expect(reembolso.balance).toBeCloseTo(92.88);
  });

  it('asigna el banco correcto y conserva el id de transacción', () => {
    for (const m of result.movements) expect(m.bank).toBe('paypal');
    expect(result.movements[0].referenceId).toBe('86H83599N7996272T');
  });

  it('usa la columna Nombre como concepto en vez de la Descripción', () => {
    const [pago, reembolso] = result.movements;
    expect(pago.concept).toBe('AllMatters ApS');
    expect(reembolso.concept).toBe('Booking.com BV');
  });

  it('se detecta el delimitador de tabuladores automáticamente', () => {
    expect(result.movements.length).toBe(2);
  });
});

describe('paypalDuplicateIds', () => {
  it('marca el cargo de banco con concepto PayPal que coincide en fecha e importe', () => {
    const paypal: Movement = {
      id: 'p1', fileId: 'f1', bank: 'paypal', date: '2023-08-31',
      type: 'expense', concept: 'Pago con Pago exprés', amount: -28,
    };
    const bankCharge: Movement = {
      id: 'b1', fileId: 'f2', bank: 'caixabank', date: '2023-08-31',
      type: 'expense', concept: 'COMPRA PAYPAL ...', amount: -28,
    };
    const hidden = paypalDuplicateIds([paypal, bankCharge]);
    expect(hidden.has('b1')).toBe(true);
    expect(hidden.has('p1')).toBe(false);
  });

  it('marca igual el cargo de banco sin depender del orden de importación (PayPal primero o después)', () => {
    const paypal: Movement = {
      id: 'p1', fileId: 'f1', bank: 'paypal', date: '2023-08-31',
      type: 'expense', concept: 'Pago con Pago exprés', amount: -28,
    };
    const bankCharge: Movement = {
      id: 'b1', fileId: 'f2', bank: 'caixabank', date: '2023-09-10',
      type: 'expense', concept: 'COMPRA PAYPAL ...', amount: -28,
    };
    // Tanto si se importa primero PayPal y luego el banco…
    const paypalPrimero = paypalDuplicateIds([paypal, bankCharge]);
    // …como a la inversa, el resultado es idéntico.
    const bancoPrimero = paypalDuplicateIds([bankCharge, paypal]);
    expect([...paypalPrimero].sort()).toEqual([...bancoPrimero].sort());
    expect(paypalPrimero.has('b1')).toBe(true);
    expect(paypalPrimero.has('p1')).toBe(false);
  });

  it('no marca nada si no hay movimiento de PayPal equivalente', () => {
    const bankCharge: Movement = {
      id: 'b1', fileId: 'f2', bank: 'santander', date: '2023-08-31',
      type: 'expense', concept: 'COMPRA PAYPAL ...', amount: -28,
    };
    const hidden = paypalDuplicateIds([bankCharge]);
    expect(hidden.size).toBe(0);
  });

  it('conserva los movimientos en el almacén aunque estén ocultos', () => {
    const paypal: Movement = {
      id: 'p1', fileId: 'f1', bank: 'paypal', date: '2023-08-31',
      type: 'expense', concept: 'Pago con Pago exprés', amount: -28,
    };
    const bankCharge: Movement = {
      id: 'b1', fileId: 'f2', bank: 'caixabank', date: '2023-08-31',
      type: 'expense', concept: 'COMPRA PAYPAL ...', amount: -28,
    };
    // La normalización no borra nada: solo marca ids a ocultar.
    const out = normalizeStoredMovements([paypal, bankCharge]);
    expect(out.map(m => m.id).sort()).toEqual(['b1', 'p1']);
    expect(paypalDuplicateIds(out).has('b1')).toBe(true);
  });

  it('no marca un cargo de banco sin concepto PayPal aunque coincida fecha e importe', () => {
    const paypal: Movement = {
      id: 'p1', fileId: 'f1', bank: 'paypal', date: '2023-08-31',
      type: 'refund', concept: 'Reembolso de pago', amount: 92.88,
    };
    const bank: Movement = {
      id: 'b1', fileId: 'f2', bank: 'caixabank', date: '2023-08-31',
      type: 'refund', concept: 'ABONO BOOKING.COM', amount: 92.88,
    };
    const hidden = paypalDuplicateIds([paypal, bank]);
    expect(hidden.size).toBe(0);
  });

  it('no marca un cargo si coincide el importe pero la fecha cae fuera de la ventana', () => {
    const paypal: Movement = {
      id: 'p1', fileId: 'f1', bank: 'paypal', date: '2023-08-31',
      type: 'expense', concept: 'Pago con Pago exprés', amount: -28,
    };
    const bankCharge: Movement = {
      id: 'b1', fileId: 'f2', bank: 'caixabank', date: '2023-09-16',
      type: 'expense', concept: 'COMPRA PAYPAL ...', amount: -28,
    };
    const hidden = paypalDuplicateIds([paypal, bankCharge]);
    expect(hidden.size).toBe(0);
  });

  it('marca el cargo si las fechas difieren hasta 15 días (en ambos sentidos)', () => {
    const paypal: Movement = {
      id: 'p1', fileId: 'f1', bank: 'paypal', date: '2023-08-31',
      type: 'expense', concept: 'Pago con Pago exprés', amount: -28,
    };
    const lateCharge: Movement = {
      id: 'b1', fileId: 'f2', bank: 'santander', date: '2023-09-15',
      type: 'expense', concept: 'COMPRA PAYPAL ...', amount: -28,
    };
    expect(paypalDuplicateIds([paypal, lateCharge]).has('b1')).toBe(true);
    const earlyCharge: Movement = {
      id: 'b2', fileId: 'f3', bank: 'caixabank', date: '2023-08-16',
      type: 'expense', concept: 'COMPRA PAYPAL ...', amount: -28,
    };
    expect(paypalDuplicateIds([paypal, earlyCharge]).has('b2')).toBe(true);
  });

  it('no marca el cargo si las fechas difieren más de 15 días', () => {
    const paypal: Movement = {
      id: 'p1', fileId: 'f1', bank: 'paypal', date: '2023-08-31',
      type: 'expense', concept: 'Pago con Pago exprés', amount: -28,
    };
    const tooLate: Movement = {
      id: 'b1', fileId: 'f2', bank: 'santander', date: '2023-09-16',
      type: 'expense', concept: 'COMPRA PAYPAL ...', amount: -28,
    };
    expect(paypalDuplicateIds([paypal, tooLate]).has('b1')).toBe(false);
  });

  it('oculta el cargo del banco aunque su concepto sea solo el comercio (sin «PAYPAL») si comparte el nombre con PayPal', () => {
    // El concepto de PayPal es el comercio (columna Nombre); el del banco
    // muestra el mismo comercio, p. ej. «MERCADONA» en lugar de «PAYPAL».
    const paypal: Movement = {
      id: 'p1', fileId: 'f1', bank: 'paypal', date: '2026-07-10',
      type: 'expense', concept: 'Mercadona', amount: -28,
    };
    const bankCharge: Movement = {
      id: 'b1', fileId: 'f2', bank: 'caixabank', date: '2026-07-14',
      type: 'expense', concept: 'MERCADONA', amount: -28,
    };
    expect(paypalDuplicateIds([paypal, bankCharge]).has('b1')).toBe(true);
  });

  it('no oculta un cargo del mismo importe y fechas cercanas pero de un comercio distinto', () => {
    const paypal: Movement = {
      id: 'p1', fileId: 'f1', bank: 'paypal', date: '2026-07-10',
      type: 'expense', concept: 'Mercadona', amount: -28,
    };
    const otherCharge: Movement = {
      id: 'b1', fileId: 'f2', bank: 'caixabank', date: '2026-07-14',
      type: 'expense', concept: 'GASOLINERA REPSOL', amount: -28,
    };
    expect(paypalDuplicateIds([paypal, otherCharge]).has('b1')).toBe(false);
  });

  it('oculta un cargo facturado por la entidad legal «COREPayPal» aunque muestre otro comercio', () => {
    // El banco carga vía «COREPayPal Europe S.a.r.l.» (con «PayPal» incrustado)
    // mientras que PayPal registra el comercio real («zooplus SE»).
    const paypal: Movement = {
      id: '1r7j92n', fileId: 't2k2t6', bank: 'paypal', date: '2026-07-10',
      type: 'expense', concept: 'zooplus SE', amount: -138.27, balance: -138.27,
    };
    const bank: Movement = {
      id: '1fd7e2p', fileId: 'xy2sct', bank: 'caixabank', date: '2026-07-14',
      type: 'expense', concept: 'COREPayPal Europe S.a.r.l. et Cie S.C.A', amount: -138.27, balance: 2408.47,
    };
    const hidden = paypalDuplicateIds([paypal, bank]);
    expect(hidden.has('1fd7e2p')).toBe(true);
    expect(hidden.has('1r7j92n')).toBe(false);
  });
});

describe('paypalTraspasos', () => {
  it('clasifica el depósito bancario en cuenta PayPal como traspaso', () => {
    const result = parsePayPal(parseDelimited([
      'Fecha\tHora\tDescripción\tNombre\tBruto ',
      '4/8/2026\t10:00:00\tDepósito bancario en cuenta PayPal\t\t42,00',
    ].join('\n')));
    expect(result.movements.length).toBe(1);
    expect(result.movements[0].type).toBe('transfer');
    expect(result.movements[0].amount).toBeCloseTo(42);
  });

  it('clasifica la retirada iniciada por el usuario como traspaso', () => {
    const result = parsePayPal(parseDelimited([
      'Fecha\tHora\tDescripción\tNombre\tBruto ',
      '4/8/2026\t10:00:00\tRetirada iniciada por el usuario\t\t-42,00',
    ].join('\n')));
    expect(result.movements.length).toBe(1);
    expect(result.movements[0].type).toBe('transfer');
    expect(result.movements[0].amount).toBeCloseTo(-42);
  });

  it('no convierte un pago con nombre de comercio en traspaso', () => {
    const result = parsePayPal(parseDelimited([
      'Fecha\tHora\tDescripción\tNombre\tBruto ',
      '4/8/2026\t10:00:00\tPago con Pago exprés\tMercadona\t-42,00',
    ].join('\n')));
    expect(result.movements[0].type).toBe('expense');
  });

  it('parsea el formato nuevo (columna Tipo/Importe) y filtra las autorizaciones generales', () => {
    const result = parsePayPal(parseDelimited([
      'Fecha\tHora\tZona horaria\tNombre\tTipo\tEstado\tDivisa\tImporte\tTarifas\tTotal\tTipo de cambio\tId. del recibo\tSaldo\tId. de transacción\tDescripción',
      '26/07/2024\t11:08:52\tCEST\tMAKSU ESPAÑA, S.L.U\tAutorización general\tPendiente\tEUR\t-3,32\t0,00\t-3,32\t\t\t0,00\t6X944045N5968970R\t',
      '26/07/2024\t11:09:06\tGMT+02:00\tMAKSU ESPAÑA, S.L.U\tPago con Pago de usuario de BillPay preaprobado\tCompletado\tEUR\t-3,32\t0,00\t-3,32\t\t\t-3,32\t8Y765054HS566081W\t',
      '26/07/2024\t11:09:06\tCEST\t\tDepósito bancario en cuenta PayPal\tPendiente\tEUR\t3,32\t0,00\t3,32\t\t\t0,00\t76B645418E7371340\t',
      '26/07/2024\t11:09:06\tCEST\tMAKSU ESPAÑA, S.L.U\tAutorización general\tCompletado\tEUR\t-3,32\t0,00\t-3,32\t\t\t0,00\t6X944045N5968970R\t',
    ].join('\n')));
    // Las dos «Autorización general» se filtran; quedan el pago (gasto) y el depósito (traspaso).
    expect(result.skipped).toBe(2);
    expect(result.movements.length).toBe(2);
    const expense = result.movements.find(m => m.type === 'expense');
    const transfer = result.movements.find(m => m.type === 'transfer');
    expect(expense?.concept).toBe('MAKSU ESPAÑA, S.L.U');
    expect(expense?.amount).toBeCloseTo(-3.32);
    expect(transfer?.amount).toBeCloseTo(3.32);
  });

  it('filtra las retenciones de cuenta para autorización abierta', () => {
    const result = parsePayPal(parseDelimited([
      'Fecha\tHora\tDescripción\tNombre\tBruto ',
      '5/8/2026\t10:00:00\tRetención de cuenta para autorización abierta\t\t1,00',
    ].join('\n')));
    expect(result.movements.length).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('filtra las cancelaciones de retención de cuenta general', () => {
    const result = parsePayPal(parseDelimited([
      'Fecha\tHora\tDescripción\tNombre\tBruto ',
      '5/8/2026\t10:00:00\tCancelación de retención de cuenta general\t\t-1,00',
    ].join('\n')));
    expect(result.movements.length).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('filtra los movimientos de autorización general', () => {
    const result = parsePayPal(parseDelimited([
      'Fecha\tHora\tDescripción\tNombre\tBruto ',
      '5/8/2026\t10:00:00\tAutorización general\t\t1,00',
    ].join('\n')));
    expect(result.movements.length).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('filtra los movimientos desprovistos de autorización', () => {
    const result = parsePayPal(parseDelimited([
      'Fecha\tHora\tTipo\tNombre\tImporte\tTarifas\tTotal',
      '5/8/2026\t10:00:00\tDesprovisto de autorización\tMAKSU ESPAÑA, S.L.U\t-3,32\t0,00\t-3,32',
    ].join('\n')));
    expect(result.movements.length).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
