import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import type { PrismaClient } from '@mint-csv-converter/receipts';
import { updateReceiptFields, UnknownParticipantError } from './receiptMutations.js';
import { seedBasicReceipt } from './testing/fixtures.js';

describe('updateReceiptFields', () => {
    let prisma: PrismaClient;
    let cleanup: () => void;

    afterEach(() => {
        cleanup();
    });

    it('a tax change recomputes Receipt.subtotal/total', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        // seedBasicReceipt: two $10 line items, subtotal/total both 20, no tax.

        await updateReceiptFields(prisma, seeded.receiptId, { tax: 2 });

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.tax).toBe(2);
        expect(receipt.subtotal).toBe(20);
        expect(receipt.total).toBe(22);
    });

    it('a purchaseDate change updates every PriceObservation tied to this receipt to match', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.priceObservation.createMany({
            data: [
                { itemId: seeded.itemIds[0], receiptId: seeded.receiptId, unitPrice: 10, quantity: 1, observedAt: new Date('2026-07-01') },
                { itemId: seeded.itemIds[1], receiptId: seeded.receiptId, unitPrice: 10, quantity: 1, observedAt: new Date('2026-07-01') },
            ],
        });

        await updateReceiptFields(prisma, seeded.receiptId, { purchaseDate: '2026-07-15' });

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.purchaseDate).toEqual(new Date('2026-07-15'));
        const observations = await prisma.priceObservation.findMany({ where: { receiptId: seeded.receiptId } });
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.observedAt).toEqual(new Date('2026-07-15'));
        }
    });

    it('plain-writes cardAmount and printedTotal', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);

        await updateReceiptFields(prisma, seeded.receiptId, { cardAmount: 18.5, printedTotal: 19.99 });

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.cardAmount).toBe(18.5);
        expect(receipt.printedTotal).toBe(19.99);
    });

    it('resolves payer by name, rejecting an unknown participant', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);

        await updateReceiptFields(prisma, seeded.receiptId, { payer: 'Patrice' });
        await expect(prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } })).resolves.toMatchObject({
            payerId: seeded.patriceId,
        });

        await expect(updateReceiptFields(prisma, seeded.receiptId, { payer: 'Nobody' })).rejects.toThrow(
            UnknownParticipantError,
        );
    });

    it('a store change re-resolves every non-removed line item against the new store, moving PriceObservations but leaving splits untouched', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.lineItemSplit.updateMany({
            where: { lineItemId: seeded.lineItemIds[0], participantId: seeded.brianId },
            data: { percent: 90 },
        });
        await prisma.lineItemSplit.updateMany({
            where: { lineItemId: seeded.lineItemIds[0], participantId: seeded.patriceId },
            data: { percent: 10 },
        });
        await prisma.priceObservation.create({
            data: {
                itemId: seeded.itemIds[0],
                receiptId: seeded.receiptId,
                unitPrice: 10,
                quantity: 1,
                observedAt: new Date('2026-07-01'),
            },
        });
        // A soft-deleted line should never be re-resolved.
        await prisma.lineItem.update({ where: { id: seeded.lineItemIds[1] }, data: { removedAt: new Date() } });

        await updateReceiptFields(prisma, seeded.receiptId, { store: 'Target' });

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId }, include: { store: true } });
        expect(receipt.store.name).toBe('Target');

        const lineItem1 = await prisma.lineItem.findUniqueOrThrow({
            where: { id: seeded.lineItemIds[0] },
            include: { item: true, splits: { include: { participant: true } } },
        });
        expect(lineItem1.item?.storeId).toBe(receipt.storeId);
        expect(lineItem1.item?.itemCode).toBe('111');
        const splitsByName = Object.fromEntries(lineItem1.splits.map((s) => [s.participant.name, s.percent]));
        expect(splitsByName).toEqual({ Brian: 90, Patrice: 10 });

        const movedObservation = await prisma.priceObservation.findFirstOrThrow({
            where: { receiptId: seeded.receiptId, unitPrice: 10 },
        });
        expect(movedObservation.itemId).toBe(lineItem1.itemId);

        // The removed line's itemId is untouched — still pointing at the old (Costco) Item.
        const lineItem2 = await prisma.lineItem.findUniqueOrThrow({ where: { id: seeded.lineItemIds[1] } });
        expect(lineItem2.itemId).toBe(seeded.itemIds[1]);
    });

    it('a store change to an existing store matches its existing Item by itemCode rather than creating a duplicate', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        const target = await prisma.store.create({ data: { name: 'Target' } });
        const targetItem = await prisma.item.create({
            data: { storeId: target.id, itemCode: '111', normalizedName: 'ALREADY THERE', lastSeenName: 'ALREADY THERE' },
        });

        await updateReceiptFields(prisma, seeded.receiptId, { store: 'Target' });

        const lineItem1 = await prisma.lineItem.findUniqueOrThrow({ where: { id: seeded.lineItemIds[0] } });
        expect(lineItem1.itemId).toBe(targetItem.id);
    });

    it('a no-op store write (same name) leaves line items untouched', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);

        await updateReceiptFields(prisma, seeded.receiptId, { store: 'Costco' });

        const lineItem1 = await prisma.lineItem.findUniqueOrThrow({ where: { id: seeded.lineItemIds[0] } });
        expect(lineItem1.itemId).toBe(seeded.itemIds[0]);
    });
});
