import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import type { PrismaClient } from '@mint-csv-converter/receipts';
import { recomputeReceiptTotals } from './receiptTotals.js';
import { seedBasicReceipt } from './testing/fixtures.js';

describe('recomputeReceiptTotals', () => {
    let prisma: PrismaClient;
    let cleanup: () => void;

    afterEach(() => {
        cleanup();
    });

    it('recomputes subtotal/total from current line items and reconciles when there are no tenders', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        // seedBasicReceipt: two $10 line items, no tenders.

        await recomputeReceiptTotals(prisma, seeded.receiptId);

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.subtotal).toBe(20);
        expect(receipt.total).toBe(20);
        expect(receipt.reconciled).toBe(true);
    });

    it('reconciles when a tender sums to the recomputed total within tolerance', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.receiptTender.create({
            data: { receiptId: seeded.receiptId, kind: 'CARD', label: 'Card', amount: 20.01 },
        });

        await recomputeReceiptTotals(prisma, seeded.receiptId);

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.reconciled).toBe(true);
    });

    it('flags unreconciled when a tender no longer matches the recomputed total', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.receiptTender.create({
            data: { receiptId: seeded.receiptId, kind: 'CARD', label: 'Card', amount: 20 },
        });

        await prisma.lineItem.update({ where: { id: seeded.lineItemIds[0] }, data: { discountAmount: 3 } });
        await recomputeReceiptTotals(prisma, seeded.receiptId);

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.subtotal).toBe(17);
        expect(receipt.total).toBe(17);
        expect(receipt.reconciled).toBe(false);
    });

    it('excludes a soft-removed line item from the recomputed totals', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.lineItem.update({ where: { id: seeded.lineItemIds[0] }, data: { removedAt: new Date() } });

        await recomputeReceiptTotals(prisma, seeded.receiptId);

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.subtotal).toBe(10);
        expect(receipt.total).toBe(10);
    });

    it('adds tax to the recomputed subtotal for the total', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.receipt.update({ where: { id: seeded.receiptId }, data: { tax: 1.5 } });

        await recomputeReceiptTotals(prisma, seeded.receiptId);

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.subtotal).toBe(20);
        expect(receipt.total).toBe(21.5);
    });
});
