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
});
