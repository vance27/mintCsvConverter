import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import type { PrismaClient } from '@mint-csv-converter/receipts';
import { getReceiptDetail, listReceipts } from './receiptQueries.js';
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

        const results = await listReceipts(prisma);

        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            id: seeded.receiptId,
            store: 'Costco',
            payer: 'Brian',
            lineItemCount: 2,
            reconciled: false,
        });
        // Even before review, the current (even-split default) aggregate is shown in the queue row.
        expect(results[0].aggregate).toEqual({ Brian: 50, Patrice: 50 });
    });

    it('weights the queue aggregate by dollar amount, not a naive average across line items', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        // A naive per-item average of 60%/50% would be 55%. Making line 1 nine
        // times line 2's value and asserting the actual weighted result (59%)
        // proves the big-ticket item dominates, as it should.
        await prisma.lineItem.update({ where: { id: seeded.lineItemIds[0] }, data: { lineTotal: 90 } });
        await prisma.lineItemSplit.updateMany({
            where: { lineItemId: seeded.lineItemIds[0], participantId: seeded.brianId },
            data: { percent: 60 },
        });
        await prisma.lineItemSplit.updateMany({
            where: { lineItemId: seeded.lineItemIds[0], participantId: seeded.patriceId },
            data: { percent: 40 },
        });

        const results = await listReceipts(prisma);

        expect(results[0].aggregate).toEqual({ Brian: 59, Patrice: 41 });
    });

    it('lists receipts of every status together, needs-review ones first', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.receipt.update({ where: { id: seeded.receiptId }, data: { status: 'SUBMITTED' } });
        // A second, still-unreviewed receipt at the same store — seedBasicReceipt
        // itself can't be called twice (it always creates a fresh "Costco" store,
        // which collides on Store.name's unique constraint).
        const secondReceipt = await prisma.receipt.create({
            data: {
                storeId: seeded.storeId,
                payerId: seeded.brianId,
                sourceSha256: 'second-receipt',
                sourcePath: '/tmp/second.pdf',
                purchaseDate: new Date('2026-07-02'),
                subtotal: 10,
                tax: 0,
                total: 10,
                cardAmount: 10,
                status: 'EXTRACTED',
                reconciled: true,
            },
        });

        const results = await listReceipts(prisma);

        expect(results.map((r) => r.id)).toEqual([secondReceipt.id, seeded.receiptId]);
        expect(results.map((r) => r.status)).toEqual(['EXTRACTED', 'SUBMITTED']);
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

    it('includes extractedStoreName in receipt detail, null when not set', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);

        expect((await getReceiptDetail(prisma, seeded.receiptId))?.extractedStoreName).toBeNull();

        await prisma.receipt.update({
            where: { id: seeded.receiptId },
            data: { extractedStoreName: 'COSTCO WHOLESALE #123' },
        });

        expect((await getReceiptDetail(prisma, seeded.receiptId))?.extractedStoreName).toBe(
            'COSTCO WHOLESALE #123',
        );
    });

    it('reports a learned provenance once an ItemSplitDefault exists, and a price-change hint', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await prisma.itemSplitDefault.create({
            data: { itemId: seeded.itemIds[0], participantId: seeded.brianId, percent: 60 },
        });

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
            data: {
                itemId: seeded.itemIds[0],
                receiptId: otherReceipt.id,
                unitPrice: 8,
                quantity: 1,
                discountAmount: 0,
                observedAt: new Date('2026-06-01'),
            },
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

    it('orders FAILED, then EXTRACTING, then QUEUED (oldest first), before needs-review and SUBMITTED', async () => {
        ({ prisma, cleanup } = createTestDb());
        const store = await prisma.store.create({ data: { name: 'Costco' } });
        const brian = await prisma.participant.create({ data: { name: 'Brian' } });

        async function placeholder(status: 'QUEUED' | 'EXTRACTING' | 'FAILED', sha: string, filename: string) {
            return prisma.receipt.create({
                data: {
                    storeId: store.id,
                    payerId: brian.id,
                    sourceSha256: sha,
                    sourcePath: '/tmp/x.pdf',
                    originalFilename: filename,
                    status,
                },
            });
        }

        const submitted = await prisma.receipt.create({
            data: {
                storeId: store.id,
                payerId: brian.id,
                sourceSha256: 'submitted',
                sourcePath: '/tmp/s.pdf',
                purchaseDate: new Date('2026-07-01'),
                subtotal: 1,
                tax: 0,
                total: 1,
                status: 'SUBMITTED',
                reconciled: true,
            },
        });
        const extracted = await prisma.receipt.create({
            data: {
                storeId: store.id,
                payerId: brian.id,
                sourceSha256: 'extracted',
                sourcePath: '/tmp/e.pdf',
                purchaseDate: new Date('2026-07-01'),
                subtotal: 1,
                tax: 0,
                total: 1,
                status: 'EXTRACTED',
                reconciled: true,
            },
        });
        const queuedFirst = await placeholder('QUEUED', 'q1', 'first.pdf');
        const queuedSecond = await placeholder('QUEUED', 'q2', 'second.pdf');
        const extracting = await placeholder('EXTRACTING', 'x1', 'extracting.pdf');
        const failed = await prisma.receipt.update({
            where: { id: (await placeholder('FAILED', 'f1', 'failed.pdf')).id },
            data: { extractionError: 'Ollama unreachable' },
        });

        const results = await listReceipts(prisma);

        expect(results.map((r) => r.id)).toEqual([
            failed.id,
            extracting.id,
            queuedFirst.id,
            queuedSecond.id,
            extracted.id,
            submitted.id,
        ]);
        expect(results.find((r) => r.id === failed.id)?.extractionError).toBe('Ollama unreachable');
        expect(results.find((r) => r.id === queuedFirst.id)?.queuePosition).toBe(1);
        expect(results.find((r) => r.id === queuedSecond.id)?.queuePosition).toBe(2);
        expect(results.find((r) => r.id === extracting.id)?.queuePosition).toBeNull();
        expect(results.find((r) => r.id === queuedFirst.id)?.originalFilename).toBe('first.pdf');
        expect(results.find((r) => r.id === queuedFirst.id)?.purchaseDate).toBeNull();
        expect(results.find((r) => r.id === queuedFirst.id)?.total).toBeNull();
    });
});
