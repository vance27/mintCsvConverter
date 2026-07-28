import { parseArgs } from 'node:util';
import {
    CsvConverterFactory,
    ImportFileToLines,
    ExportFileToLines,
    type TransactionRow,
} from '@mint-csv-converter/core';
import {
    getPrisma,
    loadPersonalExclusionsDict,
    loadVariableSplitPatterns,
    listManifestEntries,
    type ManifestEntry,
    type PrismaClient,
} from '@mint-csv-converter/receipts';
import { SheetsClient, defaultSheetsClient } from './sheetsClient.js';
import { loadSyncState, saveSyncState, defaultSyncStatePath, type SyncState } from './syncState.js';
import { toIsoDate, getPeriodLabel } from './dateUtils.js';
import { matchManifestEntry } from './manifestMatch.js';

export const USAGE = `Usage: sync.ts --input <path/to/export.csv> [name]

Converts a manually-exported Citi CSV and pushes valid transactions
straight into the Google Sheet via the deployed Apps Script endpoint,
grouped by transaction month. Excluded (invalid) rows are still written to
a local CSV, same as the core converter's CLI.

  --input <path>   Path to the Citi export CSV (required)
  --sync-state <path>  Where to track the newest date already synced per
                        payer, to avoid re-adding the same transactions on
                        a later run with an overlapping export
                        (default: ~/.config/mint-csv-converter/sync-state.json)
  name             Name of the person who paid (default: Brian)`;

export interface SyncOptions {
    inputFile: string;
    name: string;
    syncStateFile: string;
}

export function parseSyncArgs(argv: string[]): SyncOptions {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            input: { type: 'string' },
            'sync-state': { type: 'string' },
        },
    });

    if (!values.input) {
        throw new Error(USAGE);
    }

    const [name] = positionals;
    return {
        inputFile: values.input,
        name: name ?? 'Brian',
        syncStateFile: values['sync-state'] ?? defaultSyncStatePath(),
    };
}

export interface SyncDeps {
    factory: Pick<CsvConverterFactory, 'convertToExpenseSplitting'>;
    importFile: (path: string) => TransactionRow[];
    exportInvalid: (lines: TransactionRow[], name: string) => string;
    sheetsClient: Pick<SheetsClient, 'addTransactionsForPeriod'>;
    loadSyncState: (path: string) => SyncState;
    saveSyncState: (path: string, state: SyncState) => void;
    loadManifestEntries: () => Promise<ManifestEntry[]>;
}

/** Loads personalExclusions/splitRulesDict.VARIABLE from the DB (source of truth since the add_csv_rule_tables migration seeded it from CsvConverterFactory's old hardcoded defaults) into a fresh factory instance. */
export async function loadDbBackedFactory(prisma: PrismaClient): Promise<CsvConverterFactory> {
    const factory = new CsvConverterFactory();
    const [personalExclusions, variablePatterns] = await Promise.all([
        loadPersonalExclusionsDict(prisma),
        loadVariableSplitPatterns(prisma),
    ]);
    factory.personalExclusions = personalExclusions;
    factory.splitRulesDict = { VARIABLE: variablePatterns };
    return factory;
}

export async function defaultSyncDeps(prisma: PrismaClient = getPrisma()): Promise<SyncDeps> {
    return {
        factory: await loadDbBackedFactory(prisma),
        importFile: (path) => new ImportFileToLines(path).getResults(),
        exportInvalid: (lines, name) => new ExportFileToLines(lines).writeFile(name, 'INVALID'),
        sheetsClient: defaultSheetsClient(),
        loadSyncState,
        saveSyncState,
        loadManifestEntries: () => listManifestEntries(prisma),
    };
}

export interface SyncSummary {
    periodsSynced: { payerName: string; periodLabel: string; rowsAdded: number }[];
    invalidRowCount: number;
    invalidFile: string | null;
    skippedAsAlreadySynced: number;
}

// Header is discarded by convertToExpenseSplitting (it always skips index 0);
// its contents don't matter beyond having a placeholder row 0 to skip.
const PLACEHOLDER_HEADER: TransactionRow = ['Date', 'Description', '', 'Amount'];

export async function runSync(options: SyncOptions, deps: SyncDeps): Promise<SyncSummary> {
    const allRows = deps.importFile(options.inputFile);
    const dataRows = allRows.slice(1);

    const state = deps.loadSyncState(options.syncStateFile);
    const lastSyncedIso = state[options.name];

    // Only skip rows strictly older than the last sync — same-day rows are
    // reprocessed on every run. This trades an occasional visible duplicate
    // (easy to spot and delete by hand in the sheet) for never silently
    // dropping a same-day transaction that wasn't in a prior overlapping
    // export. There's no unique transaction ID in Citi's export to dedupe on
    // more precisely than date.
    const newRows = lastSyncedIso ? dataRows.filter((row) => toIsoDate(row[0]) >= lastSyncedIso) : dataRows;
    const skippedAsAlreadySynced = dataRows.length - newRows.length;

    const groups = groupRowsByPeriod(newRows);
    const manifestEntries = await deps.loadManifestEntries();

    const periodsSynced: SyncSummary['periodsSynced'] = [];
    const allInvalidLines: TransactionRow[] = [];

    for (const [periodLabel, groupRows] of groups) {
        const [result, invalidLines] = deps.factory.convertToExpenseSplitting(
            [PLACEHOLDER_HEADER, ...groupRows],
            options.name,
        );
        allInvalidLines.push(...invalidLines);

        if (result.length > 0) {
            const rowPercentages = result.map((row) =>
                row[3] === 'Variably' ? matchManifestEntry(row, options.name, manifestEntries) : null,
            );
            const addResult = await deps.sheetsClient.addTransactionsForPeriod({
                payerName: options.name,
                periodLabel,
                rows: result.map((row) => row.slice(0, 4)),
                rowPercentages,
            });
            periodsSynced.push({ payerName: options.name, periodLabel, rowsAdded: addResult.rowsAdded });
        }
    }

    let invalidFile: string | null = null;
    if (allInvalidLines.length > 0) {
        invalidFile = deps.exportInvalid(allInvalidLines, options.name);
    }

    if (dataRows.length > 0) {
        const newestIso = dataRows.reduce((max, row) => {
            const iso = toIsoDate(row[0]);
            return iso > max ? iso : max;
        }, lastSyncedIso ?? '');
        deps.saveSyncState(options.syncStateFile, { ...state, [options.name]: newestIso });
    }

    return { periodsSynced, invalidRowCount: allInvalidLines.length, invalidFile, skippedAsAlreadySynced };
}

function groupRowsByPeriod(rows: TransactionRow[]): Map<string, TransactionRow[]> {
    const groups = new Map<string, TransactionRow[]>();
    for (const row of rows) {
        const period = getPeriodLabel(row[0]);
        const group = groups.get(period);
        if (group) {
            group.push(row);
        } else {
            groups.set(period, [row]);
        }
    }
    return groups;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
    let options: SyncOptions;
    try {
        options = parseSyncArgs(argv);
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
        return;
    }

    const summary = await runSync(options, await defaultSyncDeps());

    console.log(`Synced ${summary.periodsSynced.length} period(s):`);
    for (const period of summary.periodsSynced) {
        console.log(`  ${period.payerName} ${period.periodLabel}: ${period.rowsAdded} row(s)`);
    }
    if (summary.skippedAsAlreadySynced > 0) {
        console.log(`Skipped ${summary.skippedAsAlreadySynced} row(s) already synced previously.`);
    }
    if (summary.invalidFile) {
        console.log(`${summary.invalidRowCount} row(s) excluded — see ${summary.invalidFile}`);
    }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
