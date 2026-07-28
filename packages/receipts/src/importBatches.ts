import { z } from 'zod';
import type { ImportBatch } from './generated/prisma/client.js';
import type { PrismaClient } from './db.js';

export interface ImportBatchView {
    id: number;
    title: string;
    description: string | null;
    payer: string;
    minDate: string;
    maxDate: string;
    sourceFilename: string;
    csvImportProfileId: number | null;
    createdAt: string;
    importedCount: number;
    skippedDuplicateCount: number;
    excludedCount: number;
}

export interface CreateImportBatchInput {
    title: string;
    description?: string | null;
    payer: string;
    minDate: string;
    maxDate: string;
    sourceFilename: string;
    csvImportProfileId: number | null;
    importedCount: number;
    skippedDuplicateCount: number;
    excludedCount: number;
}

export const updateImportBatchSchema = z
    .object({
        title: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
    })
    .refine((v) => v.title !== undefined || v.description !== undefined, {
        message: 'At least one of title or description must be provided',
    });
export type UpdateImportBatchInput = z.infer<typeof updateImportBatchSchema>;

function toView(row: ImportBatch): ImportBatchView {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        payer: row.payer,
        minDate: row.minDate,
        maxDate: row.maxDate,
        sourceFilename: row.sourceFilename,
        csvImportProfileId: row.csvImportProfileId,
        createdAt: row.createdAt.toISOString(),
        importedCount: row.importedCount,
        skippedDuplicateCount: row.skippedDuplicateCount,
        excludedCount: row.excludedCount,
    };
}

/** Most-recently-created first, so index 0 is the Review Transactions page's default selection. */
export async function listImportBatches(prisma: PrismaClient): Promise<ImportBatchView[]> {
    const rows = await prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toView);
}

export async function createImportBatch(prisma: PrismaClient, input: CreateImportBatchInput): Promise<ImportBatchView> {
    const row = await prisma.importBatch.create({
        data: {
            title: input.title,
            description: input.description ?? null,
            payer: input.payer,
            minDate: input.minDate,
            maxDate: input.maxDate,
            sourceFilename: input.sourceFilename,
            csvImportProfileId: input.csvImportProfileId,
            importedCount: input.importedCount,
            skippedDuplicateCount: input.skippedDuplicateCount,
            excludedCount: input.excludedCount,
        },
    });
    return toView(row);
}

export async function updateImportBatch(
    prisma: PrismaClient,
    id: number,
    input: UpdateImportBatchInput,
): Promise<ImportBatchView> {
    const row = await prisma.importBatch.update({
        where: { id },
        data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
        },
    });
    return toView(row);
}

export class ImportBatchHasSyncedTransactionsError extends Error {
    constructor(
        public readonly syncedCount: number,
        public readonly totalCount: number,
    ) {
        super(`Cannot delete: ${syncedCount} of ${totalCount} transactions already synced`);
    }
}

/**
 * Deletes an import batch and all its staged transactions — but only if
 * none of them have synced yet. ImportedTransaction.importBatchId is a
 * nullable FK with an ON DELETE SET NULL default, so a plain
 * prisma.importBatch.delete() would silently orphan its transactions
 * (leaving them under "All imports") rather than remove them; deleting the
 * transactions explicitly first is what makes this a real bulk delete.
 */
export async function deleteImportBatch(prisma: PrismaClient, id: number): Promise<void> {
    const [totalCount, syncedCount] = await Promise.all([
        prisma.importedTransaction.count({ where: { importBatchId: id } }),
        prisma.importedTransaction.count({ where: { importBatchId: id, syncedAt: { not: null } } }),
    ]);
    if (syncedCount > 0) {
        throw new ImportBatchHasSyncedTransactionsError(syncedCount, totalCount);
    }
    await prisma.$transaction([
        prisma.importedTransaction.deleteMany({ where: { importBatchId: id } }),
        prisma.importBatch.delete({ where: { id } }),
    ]);
}
