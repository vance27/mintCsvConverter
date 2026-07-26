import { aggregateSplits, ReceiptStatus, type AggregateLine, type PrismaClient } from '@mint-csv-converter/receipts';
import { appendManifestEntry } from './manifest.js';
import { generateAuditHtml, writeAuditHtml } from './auditReport.js';

export class UnresolvedLineItemsError extends Error {
  constructor(public readonly lineItemIds: number[]) {
    super(`Receipt has unreviewed line items: ${lineItemIds.join(', ')}`);
  }
}

export interface SubmitReceiptResult {
  aggregate: Record<string, number>;
  manifestPath: string;
  auditPath: string;
}

export interface SubmitReceiptOptions {
  /** Overrides for tests only — default to the real ~/.config/mint-csv-converter/ locations. */
  manifestPath?: string;
  auditDir?: string;
}

/**
 * Finalizes a receipt: requires every line item to be reviewed, upserts each
 * reviewed item's ItemSplitDefault to this receipt's just-confirmed percent
 * (Phase 2's explicit "the latest correction always wins" rule), transitions
 * the receipt straight to SUBMITTED, and writes both the manifest entry and
 * the generated audit-copy HTML.
 */
export async function submitReceipt(
  prisma: PrismaClient,
  receiptId: number,
  options: SubmitReceiptOptions = {},
): Promise<SubmitReceiptResult> {
  const receipt = await prisma.receipt.findUniqueOrThrow({
    where: { id: receiptId },
    include: {
      store: true,
      payer: true,
      lineItems: { include: { item: true, splits: { include: { participant: true } } } },
    },
  });

  const unresolved = receipt.lineItems.filter((lineItem) => !lineItem.reviewed);
  if (unresolved.length > 0) {
    throw new UnresolvedLineItemsError(unresolved.map((lineItem) => lineItem.id));
  }

  const participantNames = [...new Set(receipt.lineItems.flatMap((li) => li.splits.map((s) => s.participant.name)))];
  const aggregateLines: AggregateLine[] = receipt.lineItems.map((lineItem) => ({
    lineTotal: lineItem.lineTotal,
    discountAmount: lineItem.discountAmount,
    splits: Object.fromEntries(lineItem.splits.map((s) => [s.participant.name, s.percent])),
  }));
  const aggregate = aggregateSplits(aggregateLines, participantNames);

  await prisma.$transaction(async (tx) => {
    for (const lineItem of receipt.lineItems) {
      if (!lineItem.itemId) {
        continue;
      }
      for (const split of lineItem.splits) {
        await tx.itemSplitDefault.upsert({
          where: { itemId_participantId: { itemId: lineItem.itemId, participantId: split.participantId } },
          create: { itemId: lineItem.itemId, participantId: split.participantId, percent: split.percent },
          update: { percent: split.percent },
        });
      }
    }
    await tx.receipt.update({ where: { id: receiptId }, data: { status: ReceiptStatus.SUBMITTED, submittedAt: new Date() } });
  });

  const manifestPath = appendManifestEntry(
    {
      receiptId: receipt.id,
      store: receipt.store.name,
      payer: receipt.payer.name,
      cardAmount: receipt.cardAmount ?? receipt.total,
      purchaseDate: receipt.purchaseDate.toISOString().slice(0, 10),
      percentages: aggregate,
    },
    options.manifestPath,
  );

  const auditPath = writeAuditHtml(
    receipt.id,
    generateAuditHtml({
      receiptId: receipt.id,
      store: receipt.store.name,
      payer: receipt.payer.name,
      purchaseDate: receipt.purchaseDate.toISOString().slice(0, 10),
      total: receipt.total,
      lineItems: receipt.lineItems.map((lineItem) => ({
        name: lineItem.item?.displayName ?? lineItem.rawName,
        unitPrice: lineItem.unitPrice,
        quantity: lineItem.quantity,
        lineTotal: lineItem.lineTotal,
        splits: Object.fromEntries(lineItem.splits.map((s) => [s.participant.name, s.percent])),
      })),
      aggregate,
    }),
    options.auditDir,
  );

  return { aggregate, manifestPath, auditPath };
}
