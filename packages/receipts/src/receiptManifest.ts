import { aggregateSplits, type AggregateLine } from './aggregate.js';
import { ReceiptStatus } from './generated/prisma/enums.js';
import type { PrismaClient } from './db.js';

export interface ManifestEntry {
  receiptId: number;
  store: string;
  payer: string;
  cardAmount: number;
  /** ISO date (YYYY-MM-DD) — used as a tiebreak when multiple entries share a cardAmount. */
  purchaseDate: string;
  percentages: Record<string, number>;
}

/**
 * DB-backed replacement for the old receipt-manifest.json file — only
 * SUBMITTED receipts count as manifest entries (only submitReceipt.ts ever
 * wrote one under the old file-based scheme). Every field is otherwise
 * already derivable from Receipt + related tables, so this is a live query
 * rather than a durable write of its own.
 */
export async function listManifestEntries(prisma: PrismaClient): Promise<ManifestEntry[]> {
  const receipts = await prisma.receipt.findMany({
    where: { status: ReceiptStatus.SUBMITTED },
    include: {
      store: true,
      payer: true,
      lineItems: { include: { splits: { include: { participant: true } } } },
    },
  });

  return receipts.map((receipt) => {
    const participantNames = [
      ...new Set(receipt.lineItems.flatMap((lineItem) => lineItem.splits.map((split) => split.participant.name))),
    ];
    const aggregateLines: AggregateLine[] = receipt.lineItems.map((lineItem) => ({
      lineTotal: lineItem.lineTotal,
      discountAmount: lineItem.discountAmount,
      splits: Object.fromEntries(lineItem.splits.map((split) => [split.participant.name, split.percent])),
    }));

    // total/purchaseDate are typed nullable (a QUEUED/EXTRACTING/FAILED
    // placeholder row has neither yet), but this query is filtered to
    // SUBMITTED — reachable only via a completed EXTRACTED transition that
    // always populates both — so they're never actually null here.
    return {
      receiptId: receipt.id,
      store: receipt.store.name,
      payer: receipt.payer.name,
      cardAmount: receipt.cardAmount ?? receipt.total ?? 0,
      purchaseDate: (receipt.purchaseDate ?? receipt.createdAt).toISOString().slice(0, 10),
      percentages: aggregateSplits(aggregateLines, participantNames),
    };
  });
}
