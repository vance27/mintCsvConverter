import { describe, it, expect } from 'vitest';
import { FakeSheet } from './testing/fakeSheet.js';
import { onEdit, onHeaderChange, onDataChange, onSplitTypeChanged } from './triggers.js';

describe('onSplitTypeChanged', () => {
  it('checks every participant column for an equally-split row', () => {
    const sheet = new FakeSheet([
      ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
      ['Chipotle', 'Brian', 30, 'Equally'],
    ]);

    onSplitTypeChanged(sheet.asSheet(), 2);

    expect(sheet.grid[1][4]).toBe(true);
    expect(sheet.grid[1][5]).toBe(true);
  });

  it('sets an even percentage share for a variably-split row', () => {
    const sheet = new FakeSheet([
      ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
      ['Costco', 'Brian', 150, 'Variably'],
    ]);

    onSplitTypeChanged(sheet.asSheet(), 2);

    expect(sheet.grid[1][4]).toBe('50%');
    expect(sheet.grid[1][5]).toBe('50%');
  });
});

describe('onDataChange', () => {
  it('applies split-type defaulting when column D (SPLIT_TYPE_COLUMN) changed', () => {
    const sheet = new FakeSheet([
      ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
      ['Chipotle', 'Brian', 30, 'Equally'],
    ]);

    onDataChange(sheet.asSheet(), 2, 4, 'Equally');

    expect(sheet.grid[1][4]).toBe(true);
  });

  it('does nothing for edits to other columns', () => {
    const sheet = new FakeSheet([
      ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
      ['Chipotle', 'Brian', 30, 'Equally'],
    ]);

    onDataChange(sheet.asSheet(), 2, 3, '30');

    expect(sheet.grid[1][4]).toBeUndefined();
  });
});

describe('onHeaderChange', () => {
  it('is currently a no-op', () => {
    const sheet = new FakeSheet([['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice']]);
    const before = JSON.stringify(sheet.grid);

    onHeaderChange(sheet.asSheet(), 1, 1, 'Description');

    expect(JSON.stringify(sheet.grid)).toBe(before);
  });
});

describe('onEdit', () => {
  it('routes a data-row edit to onSplitTypeChanged and recalculates the settle-up summary', () => {
    const sheet = new FakeSheet([
      ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'], // row 1
      ['Chipotle', 'Brian', 30, 'Equally'], // row 2, edited: split type just set to Equally
      ['', '', '', 'TOTAL OWING'], // row 3, anchor = 2
      ['', '', '', true], // row 4, simplify toggle
    ]);

    const event = {
      range: { getRow: () => 2, getColumn: () => 4 },
      source: { getActiveSheet: () => sheet.asSheet() },
      value: 'Equally',
    } as unknown as GoogleAppsScript.Events.SheetsOnEdit;

    onEdit(event);

    // onSplitTypeChanged defaulted both participant checkboxes to checked...
    expect(sheet.grid[1][4]).toBe(true);
    expect(sheet.grid[1][5]).toBe(true);
    // ...and recalculateSettleUp ran: Brian paid $30 split equally, so
    // Patrice owes Brian $15 — written under Patrice's column (F, index 5)
    // on the row right after the anchor (row 3, index 2).
    expect(sheet.grid[2][5]).toBe('Brian $15.00');
  });
});
