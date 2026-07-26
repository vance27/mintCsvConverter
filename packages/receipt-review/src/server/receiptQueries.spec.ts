import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import type { PrismaClient } from '@mint-csv-converter/receipts';
import { getReceiptDetail, listReceiptsForReview } from './receiptQueries.js';
import { seedBasicReceipt } from './testing/fixtures.js';

describe('receiptQueries', () => {
  let prisma: PrismaClient;
  let cleanup: () => void;

  afterEach(() => {
    cleanup();
  });

  it('lists receipts needing review, unreconciled ones first', async () => {
    ({ prisma, cleanup } = createTestDb());
    const seeded = await seedBasicReceipt(prisma);
    await prisma.receipt.update({ where: { id: seeded.receiptId }, data: { reconciled: false } });

    const results = await listReceiptsForReview(prisma);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: seeded.receiptId, store: 'Costco', payer: 'Brian', lineItemCount: 2, reconciled: false });
  });

  it('returns full detail with splits, price history, and provenance', async () => {
    ({ prisma, cleanup } = createTestDb());
    const seeded = await seedBasicReceipt(prisma);

    const detail = await getReceiptDetail(prisma, seeded.receiptId);

    expect(detail).not.toBeNull();
    expect(detail?.lineItems).toHaveLength(2);
    for (const lineItem of detail?.lineItems ?? []) {
      expect(lineItem.splits).toEqual({ Brian: 50, Patrice: 50 });
      // Never seen before this receipt, and no ItemSplitDefault exists yet.
      expect(lineItem.provenance).toBe('new');
      expect(lineItem.priceHistory).toEqual({ previousUnitPrice: null, changePercent: null });
    }
  });

  it('reports a learned provenance once an ItemSplitDefault exists, and a price-change hint', async () => {
    ({ prisma, cleanup } = createTestDb());
    const seeded = await seedBasicReceipt(prisma);
    await prisma.itemSplitDefault.create({ data: { itemId: seeded.itemIds[0], participantId: seeded.brianId, percent: 60 } });

    // A prior observation for the same item, at a different price, on a different receipt.
    const otherReceipt = await prisma.receipt.create({
      data: {
        storeId: seeded.storeId,
        payerId: seeded.brianId,
        sourceSha256: 'other-receipt',
        sourcePath: '/tmp/other.pdf',
        purchaseDate: new Date('2026-06-01'),
        subtotal: 8,
        tax: 0,
        total: 8,
        cardAmount: 8,
        reconciled: true,
      },
    });
    await prisma.priceObservation.create({
      data: { itemId: seeded.itemIds[0], receiptId: otherReceipt.id, unitPrice: 8, quantity: 1, discountAmount: 0, observedAt: new Date('2026-06-01') },
    });

    const detail = await getReceiptDetail(prisma, seeded.receiptId);
    const line = detail?.lineItems.find((l) => l.itemId === seeded.itemIds[0]);

    expect(line?.provenance).toBe('learned');
    expect(line?.priceHistory.previousUnitPrice).toBe(8);
    expect(line?.priceHistory.changePercent).toBeCloseTo(25);
  });

  it('returns null for a nonexistent receipt', async () => {
    ({ prisma, cleanup } = createTestDb());
    expect(await getReceiptDetail(prisma, 999999)).toBeNull();
  });
});
