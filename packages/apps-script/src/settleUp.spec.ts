import { describe, it, expect } from 'vitest';
import { FakeSheet } from './testing/fakeSheet.js';
import {
  createZeroMatrix,
  buildDebtMatrix,
  indexOfMin,
  indexOfMax,
  simplifyDebts,
  computeSettlementPayments,
  writeSettlementPayments,
  recalculateSettleUp,
} from './settleUp.js';

describe('createZeroMatrix', () => {
  it('returns a size x size matrix of zeros', () => {
    expect(createZeroMatrix(3)).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });
});

describe('indexOfMin / indexOfMax', () => {
  it('finds the index of the smallest and largest values', () => {
    expect(indexOfMin([3, -1, 5])).toBe(1);
    expect(indexOfMax([3, -1, 5])).toBe(2);
  });
});

// Chipotle: Brian paid $30, split equally between Brian & Patrice -> Patrice owes Brian $15.
// Costco: Patrice paid $100, split variably 60/40 (Brian/Patrice) -> Brian owes Patrice $60.
// Net: Brian owes Patrice $45 (60 - 15).
function buildTwoTransactionSheet(simplify: boolean): FakeSheet {
  return new FakeSheet([
    ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'], // row 1
    ['Chipotle', 'Brian', 30, 'Equally', true, true], // row 2
    ['Costco', 'Patrice', 100, 'Variably', 60, 40], // row 3
    ['', '', '', 'TOTAL OWING'], // row 4 (anchor = 3)
    ['', '', '', simplify], // row 5: simplify toggle
  ]);
}

describe('buildDebtMatrix', () => {
  it('divides equally-split amounts evenly and variably-split amounts proportionally', () => {
    const sheet = buildTwoTransactionSheet(true);
    const participantNames = ['Brian', 'Patrice'];
    const participantIndexByName = { Brian: 0, Patrice: 1 };

    const debtMatrix = buildDebtMatrix(sheet.asSheet(), participantNames, participantIndexByName, 2, 3);

    expect(debtMatrix).toEqual([
      [0, 60], // Brian owes Patrice $60 (Costco)
      [15, 0], // Patrice owes Brian $15 (Chipotle)
    ]);
  });
});

describe('simplifyDebts', () => {
  it('reduces a debt matrix to the minimal net payments', () => {
    const debtMatrix = [
      [0, 60],
      [15, 0],
    ];
    const payments = simplifyDebts(new FakeSheet([]).asSheet(), debtMatrix, ['Brian', 'Patrice'], { Brian: 0, Patrice: 1 }, 2, 3);

    // Brian (index 0) pays Patrice (index 1) the net $45.
    expect(payments).toEqual([[0, 1, 45]]);
  });
});

describe('computeSettlementPayments', () => {
  it('simplifies when the toggle is checked', () => {
    const sheet = buildTwoTransactionSheet(true);
    const debtMatrix = [
      [0, 60],
      [15, 0],
    ];
    const payments = computeSettlementPayments(sheet.asSheet(), debtMatrix, ['Brian', 'Patrice'], { Brian: 0, Patrice: 1 }, 2, 3);
    expect(payments).toEqual([[0, 1, 45]]);
  });

  it('returns every non-zero pairwise debt verbatim when the toggle is unchecked', () => {
    const sheet = buildTwoTransactionSheet(false);
    const debtMatrix = [
      [0, 60],
      [15, 0],
    ];
    const payments = computeSettlementPayments(sheet.asSheet(), debtMatrix, ['Brian', 'Patrice'], { Brian: 0, Patrice: 1 }, 2, 3);
    expect(payments).toEqual([
      [0, 1, 60],
      [1, 0, 15],
    ]);
  });
});

describe('writeSettlementPayments', () => {
  it('clears the settlement area and writes "<payee> $<amount>" under each payer column', () => {
    const sheet = buildTwoTransactionSheet(true);
    writeSettlementPayments(sheet.asSheet(), [[0, 1, 45]], ['Brian', 'Patrice'], { Brian: 0, Patrice: 1 }, 2, 3);

    // Row 4 (totalRowAnchor + 1), column E (Brian, PARTICIPANT_COLUMN_OFFSET + 0 + 1).
    expect(sheet.grid[3][4]).toBe('Patrice $45.00');
  });
});

describe('recalculateSettleUp', () => {
  it('runs the full pipeline end to end: builds the matrix, simplifies, and writes the result', () => {
    const sheet = buildTwoTransactionSheet(true);
    recalculateSettleUp(sheet.asSheet());

    expect(sheet.grid[3][4]).toBe('Patrice $45.00');
  });

  it('writes the verbatim (non-simplified) payments when the toggle is unchecked', () => {
    const sheet = buildTwoTransactionSheet(false);
    recalculateSettleUp(sheet.asSheet());

    // Brian's column (E) gets what Brian owes Patrice; Patrice's column (F)
    // gets what Patrice owes Brian.
    expect(sheet.grid[3][4]).toBe('Patrice $60.00');
    expect(sheet.grid[3][5]).toBe('Brian $15.00');
  });
});
