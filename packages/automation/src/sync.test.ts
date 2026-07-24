import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CsvConverterFactory, type TransactionRow } from '@mint-csv-converter/core';
import type { AddTransactionsRequest } from './sheetsClient.js';
import { runSync, parseSyncArgs, type SyncDeps } from './sync.js';

function makeDeps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    factory: new CsvConverterFactory(),
    importFile: mock.fn(() => [] as TransactionRow[]),
    exportInvalid: mock.fn(() => 'invalid.csv'),
    sheetsClient: {
      addTransactionsForPeriod: mock.fn(async (_request: AddTransactionsRequest) => ({ sheetName: 'x', rowsAdded: 0 })),
    },
    loadSyncState: mock.fn(() => ({})),
    saveSyncState: mock.fn(),
    ...overrides,
  };
}

describe('runSync', () => {
  it('groups rows by month and calls sheetsClient once per period', async () => {
    const addTransactionsForPeriod = mock.fn(async (_request: AddTransactionsRequest) => ({ sheetName: 'Brian 06/26', rowsAdded: 1 }));
    const deps = makeDeps({
      importFile: () => [
        ['Date', 'Description', '', 'Amount'],
        ['06/20/2026', 'Chipotle Mexican Grill', '', '25.00'],
        ['07/02/2026', 'Chick-fil-A', '', '12.00'],
      ],
      sheetsClient: { addTransactionsForPeriod },
    });

    const summary = await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

    assert.equal(addTransactionsForPeriod.mock.calls.length, 2);
    assert.equal(summary.periodsSynced.length, 2);
    assert.deepEqual(
      summary.periodsSynced.map((p) => p.periodLabel).sort(),
      ['06/26', '07/26'],
    );
  });

  it('writes excluded rows to a local file via exportInvalid', async () => {
    const exportInvalid = mock.fn(() => 'Brian_2026_INVALID.csv');
    const deps = makeDeps({
      importFile: () => [
        ['Date', 'Description', '', 'Amount'],
        ['06/22/2026', 'CITI CARD PAYMENT', '', '500.00'],
      ],
      exportInvalid,
    });

    const summary = await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

    assert.equal(exportInvalid.mock.calls.length, 1);
    assert.equal(summary.invalidRowCount, 1);
    assert.equal(summary.invalidFile, 'Brian_2026_INVALID.csv');
  });

  it('saves the newest transaction date seen per payer', async () => {
    const saveSyncState = mock.fn();
    const deps = makeDeps({
      importFile: () => [
        ['Date', 'Description', '', 'Amount'],
        ['06/20/2026', 'Chipotle', '', '25.00'],
        ['06/25/2026', 'Costco Wholesale', '', '150.00'],
      ],
      saveSyncState,
    });

    await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

    assert.equal(saveSyncState.mock.calls.length, 1);
    assert.deepEqual(saveSyncState.mock.calls[0]!.arguments, ['state.json', { Brian: '2026-06-25' }]);
  });

  it('skips rows strictly before the last synced date but still reprocesses same-day rows', async () => {
    const addTransactionsForPeriod = mock.fn(async (_request: AddTransactionsRequest) => ({ sheetName: 'x', rowsAdded: 1 }));
    const deps = makeDeps({
      importFile: () => [
        ['Date', 'Description', '', 'Amount'],
        ['06/20/2026', 'Chipotle', '', '25.00'], // strictly before last sync -> skipped
        ['06/25/2026', 'Costco Wholesale', '', '150.00'], // same day as last sync -> reprocessed
        ['06/26/2026', "Chick-fil-A", '', '12.00'], // after last sync -> processed
      ],
      loadSyncState: () => ({ Brian: '2026-06-25' }),
      sheetsClient: { addTransactionsForPeriod },
    });

    const summary = await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

    assert.equal(summary.skippedAsAlreadySynced, 1);
    // Both remaining rows fall in the same period (06/26), so one grouped call.
    assert.equal(addTransactionsForPeriod.mock.calls.length, 1);
    const requestArg = addTransactionsForPeriod.mock.calls[0]!.arguments[0] as { rows: string[][] };
    assert.equal(requestArg.rows.length, 2);
  });

  it('only sends columns A-D to the Sheets endpoint', async () => {
    const addTransactionsForPeriod = mock.fn(async (_request: AddTransactionsRequest) => ({ sheetName: 'x', rowsAdded: 1 }));
    const deps = makeDeps({
      importFile: () => [
        ['Date', 'Description', '', 'Amount'],
        ['06/20/2026', 'Costco Wholesale', '', '150.00'],
      ],
      sheetsClient: { addTransactionsForPeriod },
    });

    await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

    const requestArg = addTransactionsForPeriod.mock.calls[0]!.arguments[0] as { rows: string[][] };
    assert.deepEqual(requestArg.rows, [['Costco Wholesale 06/20/2026', 'Brian', '150.00', 'Variably']]);
  });
});

describe('parseSyncArgs', () => {
  it('throws when --input is missing', () => {
    assert.throws(() => parseSyncArgs([]));
  });

  it('defaults name to Brian and fills in a sync-state path', () => {
    const options = parseSyncArgs(['--input', 'export.csv']);
    assert.equal(options.inputFile, 'export.csv');
    assert.equal(options.name, 'Brian');
    assert.ok(options.syncStateFile.length > 0);
  });

  it('accepts an explicit name and sync-state path', () => {
    const options = parseSyncArgs(['--input', 'export.csv', '--sync-state', 'state.json', 'Patrice']);
    assert.equal(options.name, 'Patrice');
    assert.equal(options.syncStateFile, 'state.json');
  });
});
