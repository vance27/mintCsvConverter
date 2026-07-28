import { describe, it, expect, vi } from 'vitest';
import { CsvConverterFactory, type TransactionRow } from '@mint-csv-converter/core';
import type { ManifestEntry } from '@mint-csv-converter/receipts';
import type { AddTransactionsRequest } from './sheetsClient.js';
import { runSync, parseSyncArgs, type SyncDeps } from './sync.js';

function makeDeps(overrides: Partial<SyncDeps> = {}): SyncDeps {
    return {
        factory: new CsvConverterFactory(),
        importFile: vi.fn(() => [] as TransactionRow[]),
        exportInvalid: vi.fn(() => 'invalid.csv'),
        sheetsClient: {
            addTransactionsForPeriod: vi.fn(async (_request: AddTransactionsRequest) => ({
                sheetName: 'x',
                rowsAdded: 0,
            })),
        },
        loadSyncState: vi.fn(() => ({})),
        saveSyncState: vi.fn(),
        loadManifestEntries: vi.fn(async (): Promise<ManifestEntry[]> => []),
        ...overrides,
    };
}

describe('runSync', () => {
    it('groups rows by month and calls sheetsClient once per period', async () => {
        const addTransactionsForPeriod = vi.fn(async (_request: AddTransactionsRequest) => ({
            sheetName: 'Brian 06/26',
            rowsAdded: 1,
        }));
        const deps = makeDeps({
            importFile: () => [
                ['Date', 'Description', '', 'Amount'],
                ['06/20/2026', 'Chipotle Mexican Grill', '', '25.00'],
                ['07/02/2026', 'Chick-fil-A', '', '12.00'],
            ],
            sheetsClient: { addTransactionsForPeriod },
        });

        const summary = await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

        expect(addTransactionsForPeriod.mock.calls.length).toBe(2);
        expect(summary.periodsSynced.length).toBe(2);
        expect(summary.periodsSynced.map((p) => p.periodLabel).sort()).toEqual(['06/26', '07/26']);
    });

    it('writes excluded rows to a local file via exportInvalid', async () => {
        const exportInvalid = vi.fn(() => 'Brian_2026_INVALID.csv');
        const deps = makeDeps({
            importFile: () => [
                ['Date', 'Description', '', 'Amount'],
                ['06/22/2026', 'CITI CARD PAYMENT', '', '500.00'],
            ],
            exportInvalid,
        });

        const summary = await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

        expect(exportInvalid.mock.calls.length).toBe(1);
        expect(summary.invalidRowCount).toBe(1);
        expect(summary.invalidFile).toBe('Brian_2026_INVALID.csv');
    });

    it('saves the newest transaction date seen per payer', async () => {
        const saveSyncState = vi.fn();
        const deps = makeDeps({
            importFile: () => [
                ['Date', 'Description', '', 'Amount'],
                ['06/20/2026', 'Chipotle', '', '25.00'],
                ['06/25/2026', 'Costco Wholesale', '', '150.00'],
            ],
            saveSyncState,
        });

        await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

        expect(saveSyncState.mock.calls.length).toBe(1);
        expect(saveSyncState.mock.calls[0]).toEqual(['state.json', { Brian: '2026-06-25' }]);
    });

    it('skips rows strictly before the last synced date but still reprocesses same-day rows', async () => {
        const addTransactionsForPeriod = vi.fn(async (_request: AddTransactionsRequest) => ({
            sheetName: 'x',
            rowsAdded: 1,
        }));
        const deps = makeDeps({
            importFile: () => [
                ['Date', 'Description', '', 'Amount'],
                ['06/20/2026', 'Chipotle', '', '25.00'], // strictly before last sync -> skipped
                ['06/25/2026', 'Costco Wholesale', '', '150.00'], // same day as last sync -> reprocessed
                ['06/26/2026', 'Chick-fil-A', '', '12.00'], // after last sync -> processed
            ],
            loadSyncState: () => ({ Brian: '2026-06-25' }),
            sheetsClient: { addTransactionsForPeriod },
        });

        const summary = await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

        expect(summary.skippedAsAlreadySynced).toBe(1);
        // Both remaining rows fall in the same period (06/26), so one grouped call.
        expect(addTransactionsForPeriod.mock.calls.length).toBe(1);
        const requestArg = addTransactionsForPeriod.mock.calls[0][0] as { rows: string[][] };
        expect(requestArg.rows.length).toBe(2);
    });

    it('only sends columns A-D to the Sheets endpoint', async () => {
        const addTransactionsForPeriod = vi.fn(async (_request: AddTransactionsRequest) => ({
            sheetName: 'x',
            rowsAdded: 1,
        }));
        const deps = makeDeps({
            importFile: () => [
                ['Date', 'Description', '', 'Amount'],
                ['06/20/2026', 'Costco Wholesale', '', '150.00'],
            ],
            sheetsClient: { addTransactionsForPeriod },
        });

        await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

        const requestArg = addTransactionsForPeriod.mock.calls[0][0] as { rows: string[][] };
        expect(requestArg.rows).toEqual([['Costco Wholesale 06/20/2026', 'Brian', '150.00', 'Variably']]);
    });

    it('leaves rowPercentages null for a Variably row with no manifest match', async () => {
        const addTransactionsForPeriod = vi.fn(async (_request: AddTransactionsRequest) => ({
            sheetName: 'x',
            rowsAdded: 1,
        }));
        const deps = makeDeps({
            importFile: () => [
                ['Date', 'Description', '', 'Amount'],
                ['06/20/2026', 'Costco Wholesale', '', '150.00'],
            ],
            sheetsClient: { addTransactionsForPeriod },
        });

        await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

        const requestArg = addTransactionsForPeriod.mock.calls[0][0] as { rowPercentages: unknown[] };
        expect(requestArg.rowPercentages).toEqual([null]);
    });

    it('fills rowPercentages for a Variably row matching a manifest entry', async () => {
        const addTransactionsForPeriod = vi.fn(async (_request: AddTransactionsRequest) => ({
            sheetName: 'x',
            rowsAdded: 1,
        }));
        const deps = makeDeps({
            importFile: () => [
                ['Date', 'Description', '', 'Amount'],
                ['06/20/2026', 'Costco Wholesale', '', '150.00'],
            ],
            sheetsClient: { addTransactionsForPeriod },
            loadManifestEntries: async (): Promise<ManifestEntry[]> => [
                {
                    receiptId: 1,
                    store: 'Costco',
                    payer: 'Brian',
                    cardAmount: 150.0,
                    purchaseDate: '2026-06-20',
                    percentages: { Brian: 62, Patrice: 38 },
                },
            ],
        });

        await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

        const requestArg = addTransactionsForPeriod.mock.calls[0][0] as { rowPercentages: unknown[] };
        expect(requestArg.rowPercentages).toEqual([{ Brian: 62, Patrice: 38 }]);
    });

    it('never sets rowPercentages for an Equally-split row', async () => {
        const addTransactionsForPeriod = vi.fn(async (_request: AddTransactionsRequest) => ({
            sheetName: 'x',
            rowsAdded: 1,
        }));
        const deps = makeDeps({
            importFile: () => [
                ['Date', 'Description', '', 'Amount'],
                ['06/20/2026', 'Chipotle', '', '25.00'],
            ],
            sheetsClient: { addTransactionsForPeriod },
        });

        await runSync({ inputFile: 'x.csv', name: 'Brian', syncStateFile: 'state.json' }, deps);

        const requestArg = addTransactionsForPeriod.mock.calls[0][0] as { rowPercentages: unknown[] };
        expect(requestArg.rowPercentages).toEqual([null]);
    });
});

describe('parseSyncArgs', () => {
    it('throws when --input is missing', () => {
        expect(() => parseSyncArgs([])).toThrow();
    });

    it('defaults name to Brian and fills in a sync-state path', () => {
        const options = parseSyncArgs(['--input', 'export.csv']);
        expect(options.inputFile).toBe('export.csv');
        expect(options.name).toBe('Brian');
        expect(options.syncStateFile.length).toBeGreaterThan(0);
    });

    it('accepts an explicit name and sync-state path', () => {
        const options = parseSyncArgs(['--input', 'export.csv', '--sync-state', 'state.json', 'Patrice']);
        expect(options.name).toBe('Patrice');
        expect(options.syncStateFile).toBe('state.json');
    });
});
