import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import type { PrismaClient } from '@mint-csv-converter/receipts';
import { SplitsSumError, updateLineItemSplits } from './lineItemReview.js';
import { seedBasicReceipt } from './testing/fixtures.js';

describe('updateLineItemSplits', () => {
  let prisma: PrismaClient;
  let cleanup: () => void;

  afterEach(() => {
    cleanup();
  });

  it('upserts splits, marks the line reviewed, and updates the display name', async () => {
    ({ prisma, cleanup } = createTestDb());
    const seeded = await seedBasicReceipt(prisma);

    await updateLineItemSplits(prisma, seeded.lineItemIds[0], {
      splits: { Brian: 70, Patrice: 30 },
      displayName: 'Fancy Widget',
    });

    const lineItem = await prisma.lineItem.findUniqueOrThrow({
      where: { id: seeded.lineItemIds[0] },
      include: { item: true, splits: { include: { participant: true } } },
    });
    expect(lineItem.reviewed).toBe(true);
    expect(lineItem.item?.displayName).toBe('Fancy Widget');
    const splitsByName = Object.fromEntries(lineItem.splits.map((s) => [s.participant.name, s.percent]));
    expect(splitsByName).toEqual({ Brian: 70, Patrice: 30 });
  });

  it('rejects splits that do not sum to 100', async () => {
    ({ prisma, cleanup } = createTestDb());
    const seeded = await seedBasicReceipt(prisma);

    await expect(updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 70, Patrice: 20 } })).rejects.toThrow(
      SplitsSumError,
    );
  });

  it('a netPrice edit sets discountAmount and recomputes Receipt.subtotal/total, leaving unitPrice/lineTotal untouched', async () => {
    ({ prisma, cleanup } = createTestDb());
    const seeded = await seedBasicReceipt(prisma);
    // seedBasicReceipt: two $10 line items, subtotal/total both 20, no tax.

    await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 50, Patrice: 50 }, netPrice: 7 });

    const lineItem = await prisma.lineItem.findUniqueOrThrow({ where: { id: seeded.lineItemIds[0] } });
    expect(lineItem.unitPrice).toBe(10);
    expect(lineItem.lineTotal).toBe(10);
    expect(lineItem.discountAmount).toBe(3);

    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
    expect(receipt.subtotal).toBe(17); // (10 - 3) + 10
    expect(receipt.total).toBe(17);
  });

  it('leaving out netPrice does not touch Receipt.subtotal/total', async () => {
    ({ prisma, cleanup } = createTestDb());
    const seeded = await seedBasicReceipt(prisma);

    await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 50, Patrice: 50 } });

    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
    expect(receipt.subtotal).toBe(20);
    expect(receipt.total).toBe(20);
  });

  it('flips reconciled to false when a price edit makes the tender breakdown no longer match the corrected total', async () => {
    ({ prisma, cleanup } = createTestDb());
    const seeded = await seedBasicReceipt(prisma);
    await prisma.receiptTender.create({ data: { receiptId: seeded.receiptId, kind: 'CARD', label: 'Card', amount: 20 } });
    await prisma.receipt.update({ where: { id: seeded.receiptId }, data: { reconciled: true } });

    await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 50, Patrice: 50 }, netPrice: 7 });

    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
    expect(receipt.total).toBe(17);
    expect(receipt.reconciled).toBe(false); // tender still 20, total now 17
  });
});
