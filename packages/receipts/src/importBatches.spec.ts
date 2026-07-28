import { describe, it, expect, afterEach } from 'vitest';
import {
    listImportBatches,
    createImportBatch,
    updateImportBatch,
    deleteImportBatch,
    ImportBatchHasSyncedTransactionsError,
    type CreateImportBatchInput,
} from './importBatches.js';
import { createTestDb } from './testing/testDb.js';
import type { PrismaClient } from './db.js';

const CITI_JULY_BATCH: CreateImportBatchInput = {
    title: 'Brian — 06/20/2026–07/02/2026',
    description: null,
    payer: 'Brian',
    minDate: '06/20/2026',
    maxDate: '07/02/2026',
    sourceFilename: 'citi_export.csv',
    csvImportProfileId: null,
    importedCount: 3,
    skippedDuplicateCount: 1,
    excludedCount: 2,
};

describe('importBatches', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    function db() {
        const { prisma, cleanup } = createTestDb();
        cleanups.push(cleanup);
        return prisma;
    }

    it('creates a batch and lists it back', async () => {
        const prisma = db();
        const created = await createImportBatch(prisma, CITI_JULY_BATCH);
        expect(created.title).toBe(CITI_JULY_BATCH.title);
        expect(created.minDate).toBe('06/20/2026');
        expect(created.maxDate).toBe('07/02/2026');

        const listed = await listImportBatches(prisma);
        expect(listed).toEqual([created]);
    });

    it('lists most-recently-created batch first', async () => {
        const prisma = db();
        const first = await createImportBatch(prisma, { ...CITI_JULY_BATCH, title: 'First' });
        const second = await createImportBatch(prisma, { ...CITI_JULY_BATCH, title: 'Second' });

        const listed = await listImportBatches(prisma);
        expect(listed.map((b) => b.id)).toEqual([second.id, first.id]);
    });

    it('updates title and description independently', async () => {
        const prisma = db();
        const created = await createImportBatch(prisma, CITI_JULY_BATCH);

        const titled = await updateImportBatch(prisma, created.id, { title: 'Renamed' });
        expect(titled.title).toBe('Renamed');
        expect(titled.description).toBeNull();

        const described = await updateImportBatch(prisma, created.id, {
            description: 'Remember the July return credit',
        });
        expect(described.title).toBe('Renamed');
        expect(described.description).toBe('Remember the July return credit');
    });
});

async function seedTransaction(
    prisma: PrismaClient,
    importBatchId: number,
    description: string,
    syncedAt: Date | null,
) {
    return prisma.importedTransaction.create({
        data: {
            payer: 'Brian',
            date: '06/20/2026',
            description,
            amount: 10,
            splitType: 'Equally',
            importBatchId,
            syncedAt,
        },
    });
}

describe('deleteImportBatch', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    function db() {
        const { prisma, cleanup } = createTestDb();
        cleanups.push(cleanup);
        return prisma;
    }

    it('deletes an all-unsynced batch and its transactions', async () => {
        const prisma = db();
        const batch = await createImportBatch(prisma, CITI_JULY_BATCH);
        await seedTransaction(prisma, batch.id, 'Chipotle', null);
        await seedTransaction(prisma, batch.id, 'Chick-fil-A', null);

        await deleteImportBatch(prisma, batch.id);

        await expect(prisma.importBatch.findUnique({ where: { id: batch.id } })).resolves.toBeNull();
        await expect(prisma.importedTransaction.count({ where: { importBatchId: batch.id } })).resolves.toBe(0);
    });

    it('rejects deleting a batch with any synced transactions, deleting nothing', async () => {
        const prisma = db();
        const batch = await createImportBatch(prisma, CITI_JULY_BATCH);
        await seedTransaction(prisma, batch.id, 'Chipotle', new Date('2026-07-01'));
        await seedTransaction(prisma, batch.id, 'Chick-fil-A', null);

        await expect(deleteImportBatch(prisma, batch.id)).rejects.toThrow(ImportBatchHasSyncedTransactionsError);
        try {
            await deleteImportBatch(prisma, batch.id);
        } catch (error) {
            expect(error).toBeInstanceOf(ImportBatchHasSyncedTransactionsError);
            expect((error as ImportBatchHasSyncedTransactionsError).syncedCount).toBe(1);
            expect((error as ImportBatchHasSyncedTransactionsError).totalCount).toBe(2);
        }

        await expect(prisma.importBatch.findUnique({ where: { id: batch.id } })).resolves.not.toBeNull();
        await expect(prisma.importedTransaction.count({ where: { importBatchId: batch.id } })).resolves.toBe(2);
    });
});
