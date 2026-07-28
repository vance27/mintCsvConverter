import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import type { PrismaClient } from '@mint-csv-converter/receipts';
import {
    SplitsSumError,
    updateLineItemSplits,
    deleteLineItem,
    restoreLineItem,
    addLineItem,
    updateLineItemCode,
} from './lineItemReview.js';
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

        await expect(
            updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 70, Patrice: 20 } }),
        ).rejects.toThrow(SplitsSumError);
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
        await prisma.receiptTender.create({
            data: { receiptId: seeded.receiptId, kind: 'CARD', label: 'Card', amount: 20 },
        });
        await prisma.receipt.update({ where: { id: seeded.receiptId }, data: { reconciled: true } });

        await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 50, Patrice: 50 }, netPrice: 7 });

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.total).toBe(17);
        expect(receipt.reconciled).toBe(false); // tender still 20, total now 17
    });

    it('a unitPrice/quantity edit recomputes lineTotal and syncs the line’s PriceObservation', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.priceObservation.create({
            data: {
                itemId: seeded.itemIds[0],
                receiptId: seeded.receiptId,
                unitPrice: 10,
                quantity: 1,
                observedAt: new Date('2026-07-01'),
            },
        });

        await updateLineItemSplits(prisma, seeded.lineItemIds[0], {
            splits: { Brian: 50, Patrice: 50 },
            unitPrice: 4,
            quantity: 3,
        });

        const lineItem = await prisma.lineItem.findUniqueOrThrow({ where: { id: seeded.lineItemIds[0] } });
        expect(lineItem.unitPrice).toBe(4);
        expect(lineItem.quantity).toBe(3);
        expect(lineItem.lineTotal).toBe(12);

        const observation = await prisma.priceObservation.findFirstOrThrow({
            where: { itemId: seeded.itemIds[0], receiptId: seeded.receiptId },
        });
        expect(observation.unitPrice).toBe(4);
        expect(observation.quantity).toBe(3);

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.subtotal).toBe(22); // 12 (corrected) + 10 (other line)
    });

    it('a netPrice edit alongside a unitPrice/quantity edit derives discountAmount from the corrected lineTotal', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);

        await updateLineItemSplits(prisma, seeded.lineItemIds[0], {
            splits: { Brian: 50, Patrice: 50 },
            unitPrice: 4,
            quantity: 3,
            netPrice: 10,
        });

        const lineItem = await prisma.lineItem.findUniqueOrThrow({ where: { id: seeded.lineItemIds[0] } });
        expect(lineItem.lineTotal).toBe(12);
        expect(lineItem.discountAmount).toBe(2); // 12 (corrected) - 10 (paid)
    });

    it('a taxable edit sets the field, and omitting it leaves an existing value untouched', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);

        await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 50, Patrice: 50 }, taxable: true });
        await expect(
            prisma.lineItem.findUniqueOrThrow({ where: { id: seeded.lineItemIds[0] } }),
        ).resolves.toMatchObject({ taxable: true });

        await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 60, Patrice: 40 } });
        await expect(
            prisma.lineItem.findUniqueOrThrow({ where: { id: seeded.lineItemIds[0] } }),
        ).resolves.toMatchObject({ taxable: true });
    });
});

describe('addLineItem', () => {
    let prisma: PrismaClient;
    let cleanup: () => void;

    afterEach(() => {
        cleanup();
    });

    it('adds a line matching an existing item, inheriting its learned split and recording a PriceObservation', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.itemSplitDefault.createMany({
            data: [
                { itemId: seeded.itemIds[0], participantId: seeded.brianId, percent: 70 },
                { itemId: seeded.itemIds[0], participantId: seeded.patriceId, percent: 30 },
            ],
        });

        await addLineItem(prisma, seeded.receiptId, {
            itemCode: '111',
            rawName: 'WIDGET (extra)',
            unitPrice: 5,
            quantity: 2,
            taxable: true,
        });

        const lineItem = await prisma.lineItem.findFirstOrThrow({
            where: { receiptId: seeded.receiptId, rawName: 'WIDGET (extra)' },
            include: { splits: { include: { participant: true } } },
        });
        expect(lineItem.itemId).toBe(seeded.itemIds[0]);
        expect(lineItem.lineTotal).toBe(10);
        expect(lineItem.taxable).toBe(true);
        const splitsByName = Object.fromEntries(lineItem.splits.map((s) => [s.participant.name, s.percent]));
        expect(splitsByName).toEqual({ Brian: 70, Patrice: 30 });

        const observation = await prisma.priceObservation.findFirstOrThrow({
            where: { itemId: seeded.itemIds[0], unitPrice: 5 },
        });
        expect(observation.quantity).toBe(2);
        expect(observation.observedAt).toEqual(new Date('2026-07-01'));

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.subtotal).toBe(30); // 10 + 10 + 10 (new line)
    });

    it('adds a brand-new item with an even default split when nothing matches', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);

        await addLineItem(prisma, seeded.receiptId, {
            itemCode: '999',
            rawName: 'BRAND NEW THING',
            unitPrice: 3,
            quantity: 1,
        });

        const lineItem = await prisma.lineItem.findFirstOrThrow({
            where: { receiptId: seeded.receiptId, rawName: 'BRAND NEW THING' },
            include: { splits: true },
        });
        expect(lineItem.taxable).toBeNull();
        expect(lineItem.splits.map((s) => s.percent).sort()).toEqual([50, 50]);
        await expect(prisma.item.count({ where: { storeId: seeded.storeId } })).resolves.toBe(3);
    });
});

describe('updateLineItemCode', () => {
    let prisma: PrismaClient;
    let cleanup: () => void;

    afterEach(() => {
        cleanup();
    });

    it('re-resolves against the corrected code, moving the PriceObservation but leaving the split untouched', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.priceObservation.create({
            data: {
                itemId: seeded.itemIds[0],
                receiptId: seeded.receiptId,
                unitPrice: 10,
                quantity: 1,
                observedAt: new Date('2026-07-01'),
            },
        });
        await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 90, Patrice: 10 } });

        await updateLineItemCode(prisma, seeded.lineItemIds[0], '222');

        const lineItem = await prisma.lineItem.findUniqueOrThrow({
            where: { id: seeded.lineItemIds[0] },
            include: { splits: { include: { participant: true } } },
        });
        expect(lineItem.itemId).toBe(seeded.itemIds[1]);
        expect(lineItem.rawItemCode).toBe('222');
        const splitsByName = Object.fromEntries(lineItem.splits.map((s) => [s.participant.name, s.percent]));
        expect(splitsByName).toEqual({ Brian: 90, Patrice: 10 });

        const movedObservation = await prisma.priceObservation.findFirstOrThrow({
            where: { receiptId: seeded.receiptId, unitPrice: 10, quantity: 1 },
        });
        expect(movedObservation.itemId).toBe(seeded.itemIds[1]);
    });
});

describe('deleteLineItem / restoreLineItem', () => {
    let prisma: PrismaClient;
    let cleanup: () => void;

    afterEach(() => {
        cleanup();
    });

    it('soft-deletes the line item, keeping its splits, and recomputes Receipt totals from what remains', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        // seedBasicReceipt: two $10 line items, subtotal/total both 20.

        await deleteLineItem(prisma, seeded.lineItemIds[0]);

        const lineItem = await prisma.lineItem.findUniqueOrThrow({ where: { id: seeded.lineItemIds[0] } });
        expect(lineItem.removedAt).not.toBeNull();
        await expect(prisma.lineItemSplit.count({ where: { lineItemId: seeded.lineItemIds[0] } })).resolves.toBe(2);
        await expect(prisma.lineItem.count({ where: { receiptId: seeded.receiptId } })).resolves.toBe(2);

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.subtotal).toBe(10);
        expect(receipt.total).toBe(10);
    });

    it('restoring a soft-deleted line item brings its split back into the recomputed total', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await deleteLineItem(prisma, seeded.lineItemIds[0]);

        await restoreLineItem(prisma, seeded.lineItemIds[0]);

        const lineItem = await prisma.lineItem.findUniqueOrThrow({
            where: { id: seeded.lineItemIds[0] },
            include: { splits: { include: { participant: true } } },
        });
        expect(lineItem.removedAt).toBeNull();
        const splitsByName = Object.fromEntries(lineItem.splits.map((s) => [s.participant.name, s.percent]));
        expect(splitsByName).toEqual({ Brian: 50, Patrice: 50 });

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.subtotal).toBe(20);
        expect(receipt.total).toBe(20);
    });
});
