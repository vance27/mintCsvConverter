import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeGasGlobals } from './testing/fakeGasGlobals.js';
import { FakeSheet } from './testing/fakeSheet.js';

installFakeGasGlobals();

const { onEdit, onHeaderChange, onDataChange, onSplitTypeChanged } = await import('./triggers.js');

describe('onSplitTypeChanged', () => {
  it('checks every participant column for an equally-split row', () => {
    const sheet = new FakeSheet([
      ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
      ['Chipotle', 'Brian', 30, 'Equally'],
    ]);

    onSplitTypeChanged(sheet.asSheet(), 2);

    assert.equal(sheet.grid[1][4], true);
    assert.equal(sheet.grid[1][5], true);
  });

  it('sets an even percentage share for a variably-split row', () => {
    const sheet = new FakeSheet([
      ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
      ['Costco', 'Brian', 150, 'Variably'],
    ]);

    onSplitTypeChanged(sheet.asSheet(), 2);

    assert.equal(sheet.grid[1][4], '50%');
    assert.equal(sheet.grid[1][5], '50%');
  });
});

describe('onDataChange', () => {
  it('applies split-type defaulting when column D (SPLIT_TYPE_COLUMN) changed', () => {
    const sheet = new FakeSheet([
      ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
      ['Chipotle', 'Brian', 30, 'Equally'],
    ]);

    onDataChange(sheet.asSheet(), 2, 4, 'Equally');

    assert.equal(sheet.grid[1][4], true);
  });

  it('does nothing for edits to other columns', () => {
    const sheet = new FakeSheet([
      ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
      ['Chipotle', 'Brian', 30, 'Equally'],
    ]);

    onDataChange(sheet.asSheet(), 2, 3, '30');

    assert.equal(sheet.grid[1][4], undefined);
  });
});

describe('onHeaderChange', () => {
  it('is currently a no-op', () => {
    const sheet = new FakeSheet([['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice']]);
    const before = JSON.stringify(sheet.grid);

    onHeaderChange(sheet.asSheet(), 1, 1, 'Description');

    assert.equal(JSON.stringify(sheet.grid), before);
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
    assert.equal(sheet.grid[1][4], true);
    assert.equal(sheet.grid[1][5], true);
    // ...and recalculateSettleUp ran: Brian paid $30 split equally, so
    // Patrice owes Brian $15 — written under Patrice's column (F, index 5)
    // on the row right after the anchor (row 3, index 2).
    assert.equal(sheet.grid[2][5], 'Brian $15.00');
  });
});
