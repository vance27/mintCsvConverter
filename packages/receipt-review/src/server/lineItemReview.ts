import { z } from 'zod';
import type { PrismaClient } from '@mint-csv-converter/receipts';
import { recomputeReceiptTotals } from './receiptTotals.js';

export const updateLineItemSplitsSchema = z.object({
  splits: z.record(z.string(), z.number().min(0).max(100)),
  displayName: z.string().min(1).optional(),
  /** Reviewer-corrected "what was actually paid" for this line — derives discountAmount, leaves unitPrice/quantity/lineTotal (the printed values) untouched. */
  netPrice: z.number().min(0).optional(),
});

export type UpdateLineItemSplitsInput = z.infer<typeof updateLineItemSplitsSchema>;

export class SplitsSumError extends Error {
  constructor(total: number) {
    super(`Splits must sum to 100, got ${total}`);
  }
}

/**
 * Saves one line item's reviewed splits (and optional item display-name
 * rename / corrected price), marking the line reviewed. Split-sum
 * validation happens here (not just at the zod-schema level) since the
 * valid sum depends on which participants are present, not a fixed shape.
 */
export async function updateLineItemSplits(
  prisma: PrismaClient,
  lineItemId: number,
  input: UpdateLineItemSplitsInput,
): Promise<void> {
  const total = Object.values(input.splits).reduce((sum, percent) => sum + percent, 0);
  if (Math.round(total) !== 100) {
    throw new SplitsSumError(total);
  }

  const lineItem = await prisma.lineItem.findUniqueOrThrow({ where: { id: lineItemId } });
  const participants = await prisma.participant.findMany({ where: { name: { in: Object.keys(input.splits) } } });

  await prisma.$transaction(async (tx) => {
    for (const participant of participants) {
      await tx.lineItemSplit.upsert({
        where: { lineItemId_participantId: { lineItemId, participantId: participant.id } },
        create: { lineItemId, participantId: participant.id, percent: input.splits[participant.name] },
        update: { percent: input.splits[participant.name] },
      });
    }
    await tx.lineItem.update({
      where: { id: lineItemId },
      data: {
        reviewed: true,
        ...(input.netPrice !== undefined ? { discountAmount: Math.round((lineItem.lineTotal - input.netPrice) * 100) / 100 } : {}),
      },
    });
    if (input.displayName && lineItem.itemId) {
      await tx.item.update({ where: { id: lineItem.itemId }, data: { displayName: input.displayName } });
    }
  });

  if (input.netPrice !== undefined) {
    await recomputeReceiptTotals(prisma, lineItem.receiptId);
  }
}
