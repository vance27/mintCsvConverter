import { describe, it, expect, afterEach } from 'vitest';
import { listManifestEntries } from './receiptManifest.js';
import { seedParticipants } from './seed.js';
import { createTestDb } from './testing/testDb.js';
import type { PrismaClient } from './db.js';

async function seedReceipt(
    prisma: PrismaClient,
    options: { status: 'EXTRACTED' | 'SUBMITTED'; brianPercent: number; patricePercent: number },
) {
    await seedParticipants(prisma, ['Brian', 'Patrice']);
    const brian = await prisma.participant.findUniqueOrThrow({ where: { name: 'Brian' } });
    const patrice = await prisma.participant.findUniqueOrThrow({ where: { name: 'Patrice' } });
    const store = await prisma.store.upsert({ where: { name: 'Costco' }, update: {}, create: { name: 'Costco' } });
    const item = await prisma.item.upsert({
        where: { storeId_itemCode: { storeId: store.id, itemCode: '1164891' } },
        update: {},
        create: {
            storeId: store.id,
            itemCode: '1164891',
            normalizedName: 'SILK ORG ALM',
            lastSeenName: 'SILK ORG.ALM',
        },
    });
    const receipt = await prisma.receipt.create({
        data: {
            storeId: store.id,
            payerId: brian.id,
            sourceSha256: `hash-${options.status}-${Math.random()}`,
            sourcePath: '/tmp/fake.pdf',
            purchaseDate: new Date('2026-07-24'),
            subtotal: 21.98,
            tax: 0,
            total: 21.98,
            cardAmount: 21.98,
            status: options.status,
            reconciled: true,
        },
    });
    const lineItem = await prisma.lineItem.create({
        data: {
            receiptId: receipt.id,
            itemId: item.id,
            rawItemCode: '1164891',
            rawName: 'SILK ORG.ALM',
            unitPrice: 21.98,
            quantity: 1,
            lineTotal: 21.98,
            discountAmount: 0,
            reviewed: true,
        },
    });
    await prisma.lineItemSplit.createMany({
        data: [
            { lineItemId: lineItem.id, participantId: brian.id, percent: options.brianPercent },
            { lineItemId: lineItem.id, participantId: patrice.id, percent: options.patricePercent },
        ],
    });
    return receipt;
}

describe('listManifestEntries', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    function db() {
        const { prisma, cleanup } = createTestDb();
        cleanups.push(cleanup);
        return prisma;
    }

    it('returns only SUBMITTED receipts, with fields matching the receipt + its aggregate split', async () => {
        const prisma = db();
        const submitted = await seedReceipt(prisma, { status: 'SUBMITTED', brianPercent: 65, patricePercent: 35 });
        await seedReceipt(prisma, { status: 'EXTRACTED', brianPercent: 50, patricePercent: 50 });

        const entries = await listManifestEntries(prisma);

        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual({
            receiptId: submitted.id,
            store: 'Costco',
            payer: 'Brian',
            cardAmount: 21.98,
            purchaseDate: '2026-07-24',
            percentages: { Brian: 65, Patrice: 35 },
        });
    });

    it('returns an empty array when there are no SUBMITTED receipts', async () => {
        const prisma = db();
        await seedReceipt(prisma, { status: 'EXTRACTED', brianPercent: 50, patricePercent: 50 });

        await expect(listManifestEntries(prisma)).resolves.toEqual([]);
    });

    it('excludes a soft-removed line item from a SUBMITTED receipt’s aggregate', async () => {
        const prisma = db();
        const submitted = await seedReceipt(prisma, { status: 'SUBMITTED', brianPercent: 65, patricePercent: 35 });
        const removedItem = await prisma.item.create({
            data: { storeId: submitted.storeId, itemCode: 'removed-1', lastSeenName: 'REMOVED THING' },
        });
        const removedLine = await prisma.lineItem.create({
            data: {
                receiptId: submitted.id,
                itemId: removedItem.id,
                rawName: 'REMOVED THING',
                unitPrice: 100,
                quantity: 1,
                lineTotal: 100,
                reviewed: true,
                removedAt: new Date(),
            },
        });
        const [brian, patrice] = await Promise.all([
            prisma.participant.findUniqueOrThrow({ where: { name: 'Brian' } }),
            prisma.participant.findUniqueOrThrow({ where: { name: 'Patrice' } }),
        ]);
        await prisma.lineItemSplit.createMany({
            data: [
                { lineItemId: removedLine.id, participantId: brian.id, percent: 0 },
                { lineItemId: removedLine.id, participantId: patrice.id, percent: 100 },
            ],
        });

        const entries = await listManifestEntries(prisma);

        // If the $100 removed line counted, the aggregate would skew heavily
        // toward Patrice instead of staying at the original 65/35.
        expect(entries[0].percentages).toEqual({ Brian: 65, Patrice: 35 });
    });
});
