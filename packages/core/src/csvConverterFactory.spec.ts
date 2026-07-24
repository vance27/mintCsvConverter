import { describe, it, beforeEach, expect } from 'vitest';
import { CsvConverterFactory, type TransactionRow } from './csvConverterFactory.js';

describe('getConverter', () => {
  let factory: CsvConverterFactory;

  beforeEach(() => {
    factory = new CsvConverterFactory();
  });

  it('raises an error naming the unsupported format', () => {
    expect(() => factory.getConverter('BAD_FORMAT')).toThrow(/BAD_FORMAT/);
  });
});

describe('isValidLine', () => {
  let factory: CsvConverterFactory;

  beforeEach(() => {
    factory = new CsvConverterFactory();
  });

  it('excludes a payer-specific banned line', () => {
    const line: TransactionRow = ['06/22/2024', 'CITI CARD PAYMENT', 'CITI', '500.00'];
    expect(factory.isValidLine(line, 'Brian')).toBe(false);
  });

  it('treats a shared line as valid', () => {
    const line: TransactionRow = ['06/22/2024', 'APPLE.COM/BILL 866-712-7753 CA', 'APPLE', '2.99'];
    expect(factory.isValidLine(line, 'Brian')).toBe(true);
  });

  it('excludes a banned line matched case-insensitively (real Citi exports are mostly ALL CAPS)', () => {
    // 'Requested transfer from ' in BRIAN's list is mixed/title case.
    const line: TransactionRow = ['06/22/2024', 'REQUESTED TRANSFER FROM SAVINGS', 'CITI', '500.00'];
    expect(factory.isValidLine(line, 'Brian')).toBe(false);
  });

  it('treats an ordinary transaction as valid', () => {
    const line: TransactionRow = ['06/20/2024', 'Chipotle Mexican Grill', 'CHIPOTLE', '25.00'];
    expect(factory.isValidLine(line, 'Brian')).toBe(true);
  });

  it('throws for an unregistered payer', () => {
    const line: TransactionRow = ['06/20/2024', 'Chipotle Mexican Grill', 'CHIPOTLE', '25.00'];
    expect(() => factory.isValidLine(line, 'Zzz')).toThrow();
  });
});

describe('isVariableSplit', () => {
  let factory: CsvConverterFactory;

  beforeEach(() => {
    factory = new CsvConverterFactory();
  });

  it('marks a variable vendor as variable', () => {
    const line: TransactionRow = ['06/21/2024', 'Costco Wholesale', 'COSTCO', '150.00'];
    expect(factory.isVariableSplit(line)).toBe(true);
  });

  it('matches vendor list entries case-insensitively (real Citi exports are mostly ALL CAPS)', () => {
    const line: TransactionRow = ['05/05/2026', 'COSTCO GAS #1646 CHASKA MN', '', '48.64'];
    expect(factory.isVariableSplit(line)).toBe(true);
  });

  it('does not mark other vendors as variable', () => {
    const line: TransactionRow = ['06/20/2024', 'Chipotle Mexican Grill', 'CHIPOTLE', '25.00'];
    expect(factory.isVariableSplit(line)).toBe(false);
  });

  it('throws when the VARIABLE key is missing', () => {
    factory.splitRulesDict = {};
    const line: TransactionRow = ['06/20/2024', 'Chipotle Mexican Grill', 'CHIPOTLE', '25.00'];
    expect(() => factory.isVariableSplit(line)).toThrow();
  });
});

describe('convertToExpenseSplitting', () => {
  let factory: CsvConverterFactory;
  let lines: TransactionRow[];

  beforeEach(() => {
    factory = new CsvConverterFactory();
    lines = [
      ['Date', 'Description', 'Original Description', 'Amount'],
      ['06/20/2024', 'Chipotle Mexican Grill', 'CHIPOTLE', '25.00'],
      ['06/21/2024', 'Costco Wholesale', 'COSTCO', '150.00'],
      ['06/22/2024', 'CITI CARD PAYMENT', 'CITI', '500.00'],
      ['06/23/2024', 'APPLE.COM/BILL 866-712-7753 CA', 'APPLE', '2.99'],
    ];
  });

  it('splits and tags valid lines correctly', () => {
    const [result] = factory.convertToExpenseSplitting(lines, 'Brian');

    expect(result).toEqual([
      ['APPLE.COM/BILL 866-712-7753 CA 06/23/2024', 'Brian', '2.99', 'Equally', 'TRUE', 'TRUE'],
      ['Costco Wholesale 06/21/2024', 'Brian', '150.00', 'Variably', '%', '%'],
      ['Chipotle Mexican Grill 06/20/2024', 'Brian', '25.00', 'Equally', 'TRUE', 'TRUE'],
    ]);
  });

  it('routes banned lines to invalid', () => {
    const [, invalidLines] = factory.convertToExpenseSplitting(lines, 'Brian');

    expect(invalidLines).toEqual([['06/22/2024', 'CITI CARD PAYMENT', 'CITI', '500.00']]);
  });
});
