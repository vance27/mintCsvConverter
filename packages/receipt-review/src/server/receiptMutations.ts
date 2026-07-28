import { unlinkSync } from 'node:fs';
import type { PrismaClient } from '@mint-csv-converter/receipts';
import { isDeletable } from '@mint-csv-converter/receipts/receiptStateMachine';

export class ReceiptNotDeletableError extends Error {
    constructor(id: number, status: string) {
        super(`Receipt ${id} can't be deleted (status: ${status})`);
    }
}

/**
 * Hard-deletes a receipt in a terminal, non-submitted status (FAILED,
 * CANCELLED, or EXTRACTED — see docs/adr/0002 and docs/adr/0008). LineItem/
 * LineItemSplit/ReceiptTender/PriceObservation rows cascade via the
 * schema's onDelete: Cascade. The retained source PDF isn't touched by
 * that cascade, so it's removed separately.
 */
export async function deleteReceipt(prisma: PrismaClient, receiptId: number): Promise<void> {
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    if (!isDeletable(receipt.status)) {
        throw new ReceiptNotDeletableError(receiptId, receipt.status);
    }
    await prisma.receipt.delete({ where: { id: receiptId } });
    unlinkSync(receipt.sourcePath);
}
