import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  installFakeGasGlobals,
  setActiveSpreadsheetForTest,
  setScriptPropertyForTest,
  resetScriptPropertiesForTest,
} from './testing/fakeGasGlobals.js';
import { FakeSheet, FakeSpreadsheet } from './testing/fakeSheet.js';

installFakeGasGlobals();

const { doPost, jsonResponse, addTransactionsForPeriod, findOrCreateSheet, findTotalOwingRowIndex } =
  await import('./syncApi.js');

const TEMPLATE_ROWS = [
  ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'], // row 1
  ['', '', '', 'TOTAL OWING'], // row 2
  ['', '', '', true], // row 3: simplify toggle
];

describe('findTotalOwingRowIndex', () => {
  it('returns the real row number of the "TOTAL OWING" marker', () => {
    const sheet = new FakeSheet(TEMPLATE_ROWS.map((row) => [...row]));
    assert.equal(findTotalOwingRowIndex(sheet.asSheet()), 2);
  });

  it('throws when no marker is found', () => {
    const sheet = new FakeSheet([['Description', 'Who Paid', 'Amount', 'How to split']]);
    assert.throws(() => findTotalOwingRowIndex(sheet.asSheet()), /Could not find "TOTAL OWING" row/);
  });
});

describe('findOrCreateSheet', () => {
  it('returns the existing sheet if one with that name already exists', () => {
    const spreadsheet = new FakeSpreadsheet();
    const existing = spreadsheet.addSheet('Brian 07/26', TEMPLATE_ROWS.map((row) => [...row]));

    const found = findOrCreateSheet(spreadsheet.asSpreadsheet(), 'Brian 07/26');

    assert.equal(found, existing.asSheet());
  });

  it('creates a new sheet by duplicating "DUPLICATE ME" when none exists', () => {
    const spreadsheet = new FakeSpreadsheet();
    spreadsheet.addSheet('DUPLICATE ME', TEMPLATE_ROWS.map((row) => [...row]));

    // findOrCreateSheet's declared return type is the ambient Sheet
    // interface; cast back to our fake to inspect its backing grid.
    const created = findOrCreateSheet(spreadsheet.asSpreadsheet(), 'Brian 07/26') as unknown as FakeSheet;

    assert.equal(created.getName(), 'Brian 07/26');
    // Preserves the template's rows (styling/validation is preserved by
    // the real copyTo(); here we can only verify the data came along).
    assert.deepEqual(created.grid[0], TEMPLATE_ROWS[0]);
    // The new sheet is now findable by its final name.
    assert.equal(spreadsheet.getSheetByName('Brian 07/26'), created);
  });

  it('throws when there is no existing sheet and no "DUPLICATE ME" template', () => {
    const spreadsheet = new FakeSpreadsheet();
    assert.throws(
      () => findOrCreateSheet(spreadsheet.asSpreadsheet(), 'Brian 07/26'),
      /Template sheet "DUPLICATE ME" not found/,
    );
  });
});

describe('addTransactionsForPeriod', () => {
  it('inserts rows above TOTAL OWING, defaults their split values, and recalculates settle-up', () => {
    const spreadsheet = new FakeSpreadsheet();
    spreadsheet.addSheet('DUPLICATE ME', TEMPLATE_ROWS.map((row) => [...row]));
    setActiveSpreadsheetForTest(spreadsheet);

    const result = addTransactionsForPeriod('Brian', '07/26', [
      ['Chipotle Mexican Grill 07/01/2026', 'Brian', '28.18', 'Equally'],
    ]);

    assert.deepEqual(result, { sheetName: 'Brian 07/26', rowsAdded: 1 });

    const sheet = spreadsheet.getSheetByName('Brian 07/26');
    assert.ok(sheet);
    // Inserted row 2: the transaction data, plus checkbox defaults applied
    // by onSplitTypeChanged.
    assert.deepEqual(sheet!.grid[1].slice(0, 4), [
      'Chipotle Mexican Grill 07/01/2026',
      'Brian',
      '28.18',
      'Equally',
    ]);
    assert.equal(sheet!.grid[1][4], true);
    assert.equal(sheet!.grid[1][5], true);
    // TOTAL OWING marker got pushed down to row 3 (index 2).
    assert.equal(sheet!.grid[2][3], 'TOTAL OWING');

    setActiveSpreadsheetForTest(undefined);
  });

  it('does nothing beyond finding/creating the sheet when rows is empty', () => {
    const spreadsheet = new FakeSpreadsheet();
    spreadsheet.addSheet('DUPLICATE ME', TEMPLATE_ROWS.map((row) => [...row]));
    setActiveSpreadsheetForTest(spreadsheet);

    const result = addTransactionsForPeriod('Brian', '07/26', []);

    assert.deepEqual(result, { sheetName: 'Brian 07/26', rowsAdded: 0 });

    setActiveSpreadsheetForTest(undefined);
  });
});

describe('jsonResponse', () => {
  it('wraps a value as a JSON text output', () => {
    const output = jsonResponse({ ok: true, result: { sheetName: 'x', rowsAdded: 1 } });
    assert.equal(output.getContent(), '{"ok":true,"result":{"sheetName":"x","rowsAdded":1}}');
    assert.equal(output.getMimeType(), 'application/json');
  });
});

describe('doPost', () => {
  beforeEach(() => {
    resetScriptPropertiesForTest();
    setActiveSpreadsheetForTest(undefined);
  });

  function makeEvent(body: unknown): GoogleAppsScript.Events.DoPost {
    return { postData: { contents: JSON.stringify(body) } } as unknown as GoogleAppsScript.Events.DoPost;
  }

  it('rejects a request with no token configured', () => {
    const response = doPost(makeEvent({ token: 'whatever', payerName: 'Brian', periodLabel: '07/26', rows: [] }));
    assert.deepEqual(JSON.parse(response.getContent()), { ok: false, error: 'Unauthorized' });
  });

  it('rejects a request with the wrong token', () => {
    setScriptPropertyForTest('SYNC_TOKEN', 'correct-token');
    const response = doPost(makeEvent({ token: 'wrong-token', payerName: 'Brian', periodLabel: '07/26', rows: [] }));
    assert.deepEqual(JSON.parse(response.getContent()), { ok: false, error: 'Unauthorized' });
  });

  it('rejects a request missing required fields', () => {
    setScriptPropertyForTest('SYNC_TOKEN', 'correct-token');
    const response = doPost(makeEvent({ token: 'correct-token', payerName: 'Brian' }));
    const body = JSON.parse(response.getContent());
    assert.equal(body.ok, false);
    assert.match(body.error, /Expected \{ token, payerName, periodLabel, rows \}/);
  });

  it('processes a valid request and returns the result', () => {
    setScriptPropertyForTest('SYNC_TOKEN', 'correct-token');
    const spreadsheet = new FakeSpreadsheet();
    spreadsheet.addSheet('DUPLICATE ME', TEMPLATE_ROWS.map((row) => [...row]));
    setActiveSpreadsheetForTest(spreadsheet);

    const response = doPost(
      makeEvent({
        token: 'correct-token',
        payerName: 'Brian',
        periodLabel: '07/26',
        rows: [['Chipotle', 'Brian', '28.18', 'Equally']],
      }),
    );

    assert.deepEqual(JSON.parse(response.getContent()), {
      ok: true,
      result: { sheetName: 'Brian 07/26', rowsAdded: 1 },
    });
  });

  it('returns ok:false with the error message when something throws', () => {
    setScriptPropertyForTest('SYNC_TOKEN', 'correct-token');
    // No active spreadsheet configured -> addTransactionsForPeriod's call
    // to SpreadsheetApp.getActiveSpreadsheet() throws.
    const response = doPost(
      makeEvent({ token: 'correct-token', payerName: 'Brian', periodLabel: '07/26', rows: [] }),
    );
    const body = JSON.parse(response.getContent());
    assert.equal(body.ok, false);
    assert.match(body.error, /setActiveSpreadsheetForTest/);
  });
});
