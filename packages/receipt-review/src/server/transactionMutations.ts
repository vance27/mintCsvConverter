import { z } from 'zod';
import type { PrismaClient } from '@mint-csv-converter/receipts';

export const updateImportedTransactionSchema = z
  .object({
    splitType: z.enum(['Equally', 'Variably']).optional(),
    removed: z.boolean().optional(),
  })
  .refine((v) => v.splitType !== undefined || v.removed !== undefined, {
    message: 'Provide splitType and/or removed',
  });

export type UpdateImportedTransactionInput = z.infer<typeof updateImportedTransactionSchema>;

export class TransactionSyncedError extends Error {
  constructor(id: number) {
    super(`Transaction ${id} has already been synced and can no longer be edited`);
  }
}

/**
 * Edits a staged transaction's split type and/or soft-deletes ("removes")
 * it — blocked once syncedAt is set, since the sheet already reflects the
 * prior value and this repo avoids silently letting the DB and sheet
 * disagree. `removed: false` clears removedAt again (undo).
 */
export async function updateImportedTransaction(
  prisma: PrismaClient,
  id: number,
  input: UpdateImportedTransactionInput,
): Promise<void> {
  const existing = await prisma.importedTransaction.findUniqueOrThrow({ where: { id } });
  if (existing.syncedAt) {
    throw new TransactionSyncedError(id);
  }

  await prisma.importedTransaction.update({
    where: { id },
    data: {
      ...(input.splitType !== undefined ? { splitType: input.splitType } : {}),
      ...(input.removed !== undefined ? { removedAt: input.removed ? new Date() : null } : {}),
    },
  });
}
