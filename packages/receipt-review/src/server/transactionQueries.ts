import { toIsoDate } from '@mint-csv-converter/automation';
import type { ImportedTransaction, PrismaClient } from '@mint-csv-converter/receipts';
import { listReceipts } from './receiptQueries.js';
import { matchTransactionToReceipt, type ReceiptMatch } from './transactionReceiptMatch.js';

export interface TransactionSummary {
  id: number;
  payer: string;
  date: string;
  description: string;
  amount: number;
  splitType: string;
  syncedAt: string | null;
  excluded: boolean;
  exclusionReason: string | null;
  removed: boolean;
  removedAt: string | null;
  receiptMatch: ReceiptMatch | null;
}

export function toTransactionSummary(
  t: ImportedTransaction,
  receipts: Parameters<typeof matchTransactionToReceipt>[1],
): TransactionSummary {
  return {
    id: t.id,
    payer: t.payer,
    date: t.date,
    description: t.description,
    amount: t.amount,
    splitType: t.splitType,
    syncedAt: t.syncedAt ? t.syncedAt.toISOString() : null,
    excluded: t.excluded,
    exclusionReason: t.exclusionReason,
    removed: t.removedAt !== null,
    removedAt: t.removedAt ? t.removedAt.toISOString() : null,
    receiptMatch: t.splitType === 'Variably' ? matchTransactionToReceipt(t, receipts) : null,
  };
}

export type TransactionSortKey = 'date' | 'payer' | 'description' | 'amount' | 'splitType' | 'syncedAt';

export interface ListImportedTransactionsParams {
  importBatchId?: number; // omitted = "All imports"
  status: 'ACTIVE' | 'EXCLUDED_REMOVED';
  syncedStatus: 'UNSYNCED' | 'SYNCED' | 'ALL';
  sortBy: TransactionSortKey;
  sortDir: 'asc' | 'desc';
  page: number; // 1-based
  pageSize: number; // enforced to 10/25/50 at the API boundary (listTransactionsQuerySchema in app.ts)
}

export interface ListImportedTransactionsResult {
  transactions: TransactionSummary[];
  totalCount: number;
}

function compareTransactions(a: ImportedTransaction, b: ImportedTransaction, sortBy: TransactionSortKey): number {
  switch (sortBy) {
    case 'date':
      // date is stored raw (MM/DD/YYYY), which doesn't sort lexically in
      // chronological order — compare via the ISO conversion instead.
      return toIsoDate(a.date).localeCompare(toIsoDate(b.date));
    case 'payer':
      return a.payer.localeCompare(b.payer);
    case 'description':
      return a.description.localeCompare(b.description);
    case 'splitType':
      return a.splitType.localeCompare(b.splitType);
    case 'amount':
      return a.amount - b.amount;
    case 'syncedAt': {
      // Unsynced (null) rows sort consistently to one end regardless of
      // direction, rather than flipping between first/last with sortDir.
      const aTime = a.syncedAt ? a.syncedAt.getTime() : -Infinity;
      const bTime = b.syncedAt ? b.syncedAt.getTime() : -Infinity;
      return aTime - bTime;
    }
  }
}

/**
 * Filters at the Prisma level (batch/status/synced), then sorts and
 * paginates in memory — this table is small at this tool's scale (personal
 * expense tracking), and `date` can't be a naive Prisma `orderBy` since raw
 * MM/DD/YYYY strings don't sort chronologically. Only fetches receipts (for
 * receiptMatch) for the rows on the current page.
 */
export async function listImportedTransactions(
  prisma: PrismaClient,
  params: ListImportedTransactionsParams,
): Promise<ListImportedTransactionsResult> {
  const where = {
    ...(params.importBatchId !== undefined ? { importBatchId: params.importBatchId } : {}),
    ...(params.status === 'ACTIVE' ? { excluded: false, removedAt: null } : { OR: [{ excluded: true }, { removedAt: { not: null } }] }),
    ...(params.syncedStatus === 'UNSYNCED' ? { syncedAt: null } : params.syncedStatus === 'SYNCED' ? { syncedAt: { not: null } } : {}),
  };

  const rows = await prisma.importedTransaction.findMany({ where });
  const sorted = rows.sort((a, b) => {
    const cmp = compareTransactions(a, b, params.sortBy);
    return params.sortDir === 'desc' ? -cmp : cmp;
  });

  const start = (params.page - 1) * params.pageSize;
  const pageRows = sorted.slice(start, start + params.pageSize);

  const receipts = await listReceipts(prisma);
  const transactions = pageRows.map((t) => toTransactionSummary(t, receipts));

  return { transactions, totalCount: rows.length };
}
