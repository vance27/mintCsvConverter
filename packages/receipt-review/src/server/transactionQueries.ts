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

/** Every staged transaction — excluded, removed, synced, or none of the above — sorted by transaction date. The client decides what to show/hide. */
export async function listImportedTransactions(prisma: PrismaClient): Promise<TransactionSummary[]> {
  const [transactions, receipts] = await Promise.all([prisma.importedTransaction.findMany(), listReceipts(prisma)]);

  return transactions
    .map((t) => toTransactionSummary(t, receipts))
    // date is stored raw (MM/DD/YYYY), which doesn't sort lexically in
    // chronological order — compare via the ISO conversion instead.
    .sort((a, b) => toIsoDate(a.date).localeCompare(toIsoDate(b.date)));
}
