import { getPeriodLabel, matchManifestEntry, type SheetsClient } from '@mint-csv-converter/automation';
import { CsvSyncRunStatus, listManifestEntries, type ImportedTransaction, type PrismaClient } from '@mint-csv-converter/receipts';

export interface SyncOverviewGroup {
  payer: string;
  periodLabel: string;
  rowCount: number;
}

export interface SyncOverview {
  totalRows: number;
  groups: SyncOverviewGroup[];
}

/** A pure read: what a "Run sync" click would do, with zero Sheets calls. */
export async function buildSyncOverview(prisma: PrismaClient): Promise<SyncOverview> {
  const transactions = await unsyncedTransactions(prisma);
  const groups = groupByPayerPeriod(transactions);
  return {
    totalRows: transactions.length,
    groups: [...groups.entries()].map(([key, txs]) => {
      const [payer, periodLabel] = splitGroupKey(key);
      return { payer, periodLabel, rowCount: txs.length };
    }),
  };
}

export interface PeriodResult {
  payerName: string;
  periodLabel: string;
  rowCount: number;
  status: 'SYNCED' | 'FAILED';
  errorMessage?: string;
}

export interface SyncRunResult {
  status: CsvSyncRunStatus;
  periodResults: PeriodResult[];
  /** Set only for a pre-flight failure (couldn't even build a Sheets client). */
  errorMessage?: string;
}

export interface RunSyncDeps {
  prisma: PrismaClient;
  /** Lazy, not a pre-built client, so a construction throw (e.g. missing OAuth token) is caught and recorded as an ERROR run instead of an unhandled rejection. */
  buildSheetsClient: () => Pick<SheetsClient, 'addTransactionsForPeriod'>;
}

/**
 * Pushes every currently-unsynced, non-excluded transaction to Sheets,
 * grouped by (payer, period) tab, one group at a time — a group failing
 * doesn't abort the rest. Records one CsvSyncRun with the outcome and marks
 * only the successfully-synced transactions' syncedAt/syncRunId, so a
 * failed group's transactions stay unsynced and get retried by the next
 * run automatically (no separate retry mechanism needed).
 */
export async function runSyncOverview(deps: RunSyncDeps): Promise<SyncRunResult> {
  const transactions = await unsyncedTransactions(deps.prisma);
  if (transactions.length === 0) {
    return { status: CsvSyncRunStatus.DONE, periodResults: [] };
  }

  let sheetsClient: Pick<SheetsClient, 'addTransactionsForPeriod'>;
  try {
    sheetsClient = deps.buildSheetsClient();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await deps.prisma.csvSyncRun.create({ data: { status: CsvSyncRunStatus.ERROR, periodResultsJson: '[]', errorMessage } });
    return { status: CsvSyncRunStatus.ERROR, periodResults: [], errorMessage };
  }

  const groups = groupByPayerPeriod(transactions);
  const manifestEntries = await listManifestEntries(deps.prisma);

  const periodResults: PeriodResult[] = [];
  const syncedTransactionIds: number[] = [];

  for (const [key, txs] of groups) {
    const [payerName, periodLabel] = splitGroupKey(key);
    const rows = txs.map((t) => [`${t.description} ${t.date}`, t.payer, t.amount.toFixed(2), t.splitType]);
    const rowPercentages = rows.map((row, i) => (txs[i].splitType === 'Variably' ? matchManifestEntry(row, payerName, manifestEntries) : null));

    try {
      await sheetsClient.addTransactionsForPeriod({ payerName, periodLabel, rows, rowPercentages });
      periodResults.push({ payerName, periodLabel, rowCount: txs.length, status: 'SYNCED' });
      syncedTransactionIds.push(...txs.map((t) => t.id));
    } catch (error) {
      periodResults.push({
        payerName,
        periodLabel,
        rowCount: txs.length,
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const status = periodResults.every((r) => r.status === 'SYNCED')
    ? CsvSyncRunStatus.DONE
    : periodResults.some((r) => r.status === 'SYNCED')
      ? CsvSyncRunStatus.PARTIAL
      : CsvSyncRunStatus.ERROR;

  const run = await deps.prisma.csvSyncRun.create({ data: { status, periodResultsJson: JSON.stringify(periodResults) } });

  if (syncedTransactionIds.length > 0) {
    await deps.prisma.importedTransaction.updateMany({
      where: { id: { in: syncedTransactionIds } },
      data: { syncedAt: new Date(), syncRunId: run.id },
    });
  }

  return { status, periodResults };
}

export interface SyncRunSummary {
  id: number;
  createdAt: string;
  status: CsvSyncRunStatus;
  periodResults: PeriodResult[];
  errorMessage: string | null;
}

/** Persisted sync run history, most recent first. */
export async function listSyncRuns(prisma: PrismaClient): Promise<SyncRunSummary[]> {
  const runs = await prisma.csvSyncRun.findMany({ orderBy: { createdAt: 'desc' } });
  return runs.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    periodResults: JSON.parse(r.periodResultsJson) as PeriodResult[],
    errorMessage: r.errorMessage,
  }));
}

function unsyncedTransactions(prisma: PrismaClient): Promise<ImportedTransaction[]> {
  return prisma.importedTransaction.findMany({ where: { excluded: false, syncedAt: null, removedAt: null } });
}

// Not a plain space — a payer name could theoretically contain one; a NUL
// byte can't appear in either a payer name or a "MM/YY" period label.
const GROUP_KEY_SEPARATOR = '\0';

function groupByPayerPeriod(transactions: ImportedTransaction[]): Map<string, ImportedTransaction[]> {
  const groups = new Map<string, ImportedTransaction[]>();
  for (const t of transactions) {
    const key = `${t.payer}${GROUP_KEY_SEPARATOR}${getPeriodLabel(t.date)}`;
    const group = groups.get(key);
    if (group) {
      group.push(t);
    } else {
      groups.set(key, [t]);
    }
  }
  return groups;
}

function splitGroupKey(key: string): [payer: string, periodLabel: string] {
  const [payer, periodLabel] = key.split(GROUP_KEY_SEPARATOR);
  return [payer, periodLabel];
}
