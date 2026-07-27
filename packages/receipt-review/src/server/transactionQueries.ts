import { toIsoDate } from '@mint-csv-converter/automation';
import type { PrismaClient } from '@mint-csv-converter/receipts';
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
  receiptMatch: ReceiptMatch | null;
}

/** Every non-excluded staged transaction (synced or not), sorted by transaction date. */
export async function listImportedTransactions(prisma: PrismaClient): Promise<TransactionSummary[]> {
  const [transactions, receipts] = await Promise.all([
    prisma.importedTransaction.findMany({ where: { excluded: false } }),
    listReceipts(prisma),
  ]);

  return transactions
    .map((t) => ({
      id: t.id,
      payer: t.payer,
      date: t.date,
      description: t.description,
      amount: t.amount,
      splitType: t.splitType,
      syncedAt: t.syncedAt ? t.syncedAt.toISOString() : null,
      receiptMatch: t.splitType === 'Variably' ? matchTransactionToReceipt(t, receipts) : null,
    }))
    // date is stored raw (MM/DD/YYYY), which doesn't sort lexically in
    // chronological order — compare via the ISO conversion instead.
    .sort((a, b) => toIsoDate(a.date).localeCompare(toIsoDate(b.date)));
}
