import { unlinkSync } from 'node:fs';
import { z } from 'zod';
import {
    findOrCreateStore,
    resolveItem,
    type ExtractedLineItem,
    type PrismaClient,
} from '@mint-csv-converter/receipts';
import { isDeletable } from '@mint-csv-converter/receipts/receiptStateMachine';
import { recomputeReceiptTotals } from './receiptTotals.js';

export class ReceiptNotDeletableError extends Error {
    constructor(id: number, status: string) {
        super(`Receipt ${id} can't be deleted (status: ${status})`);
    }
}

export class UnknownParticipantError extends Error {
    constructor(name: string) {
        super(`No participant named "${name}"`);
    }
}

export const updateReceiptFieldsSchema = z.object({
    /** Freeform, find-or-create by name — same treatment as the upload page's Store field (docs/adr/0003). */
    store: z.string().min(1).optional(),
    /** Must name an active Participant — a closed set, unlike store. */
    payer: z.string().min(1).optional(),
    /** ISO date string. */
    purchaseDate: z.string().min(1).optional(),
    tax: z.number().min(0).optional(),
    cardAmount: z.number().min(0).optional(),
    printedTotal: z.number().min(0).optional(),
});

export type UpdateReceiptFieldsInput = z.infer<typeof updateReceiptFieldsSchema>;

/**
 * Updates any subset of a receipt's header-level fields (docs/adr/0010),
 * each independently optional. Changing **store** re-resolves every
 * non-removed line item against the new store via itemResolution.ts's
 * resolveItem — the bulk version of docs/adr/0009's per-line item-code
 * correction — moving each PriceObservation but leaving splits untouched,
 * so the receipt ends up where it would if uploaded under the correct store
 * to begin with. Changing **purchaseDate** updates every PriceObservation
 * tied to this receipt to match, since they all share one receipt-wide
 * date. Changing **tax** recomputes the receipt's derived totals
 * (receiptTotals.ts). Everything else is a plain field write.
 */
export async function updateReceiptFields(
    prisma: PrismaClient,
    receiptId: number,
    input: UpdateReceiptFieldsInput,
): Promise<void> {
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });

    let payerId: number | undefined;
    if (input.payer !== undefined) {
        const participant = await prisma.participant.findUnique({ where: { name: input.payer } });
        if (!participant) {
            throw new UnknownParticipantError(input.payer);
        }
        payerId = participant.id;
    }

    // Re-resolving is only meaningful when the store actually changes — a
    // no-op re-save of the same store name shouldn't churn every line's
    // itemId/PriceObservation for nothing.
    let newStoreId: number | undefined;
    const lineItemMoves: { lineItemId: number; oldItemId: number | null; newItemId: number }[] = [];
    if (input.store !== undefined) {
        const store = await findOrCreateStore(prisma, input.store);
        if (store.id !== receipt.storeId) {
            newStoreId = store.id;
            const activeParticipants = await prisma.participant.findMany({
                where: { active: true },
                orderBy: { id: 'asc' },
            });
            const lineItems = await prisma.lineItem.findMany({ where: { receiptId, removedAt: null } });
            for (const lineItem of lineItems) {
                const extractedItem: ExtractedLineItem = {
                    itemCode: lineItem.rawItemCode,
                    rawName: lineItem.rawName,
                    quantity: lineItem.quantity,
                    unitPrice: lineItem.unitPrice,
                    lineTotal: lineItem.lineTotal,
                    taxable: lineItem.taxable,
                    discountAmount: lineItem.discountAmount,
                };
                const { item } = await resolveItem(prisma, newStoreId, extractedItem, activeParticipants);
                lineItemMoves.push({ lineItemId: lineItem.id, oldItemId: lineItem.itemId, newItemId: item.id });
            }
        }
    }

    await prisma.$transaction(async (tx) => {
        for (const move of lineItemMoves) {
            await tx.lineItem.update({ where: { id: move.lineItemId }, data: { itemId: move.newItemId } });
            if (move.oldItemId) {
                // Same (itemId, receiptId)-granularity caveat as lineItemReview.ts's updateLineItemCode.
                const observation = await tx.priceObservation.findFirst({
                    where: { receiptId, itemId: move.oldItemId },
                });
                if (observation) {
                    await tx.priceObservation.update({ where: { id: observation.id }, data: { itemId: move.newItemId } });
                }
            }
        }

        await tx.receipt.update({
            where: { id: receiptId },
            data: {
                ...(newStoreId !== undefined ? { storeId: newStoreId } : {}),
                ...(payerId !== undefined ? { payerId } : {}),
                ...(input.purchaseDate !== undefined ? { purchaseDate: new Date(input.purchaseDate) } : {}),
                ...(input.tax !== undefined ? { tax: input.tax } : {}),
                ...(input.cardAmount !== undefined ? { cardAmount: input.cardAmount } : {}),
                ...(input.printedTotal !== undefined ? { printedTotal: input.printedTotal } : {}),
            },
        });

        if (input.purchaseDate !== undefined) {
            await tx.priceObservation.updateMany({
                where: { receiptId },
                data: { observedAt: new Date(input.purchaseDate) },
            });
        }
    });

    if (input.tax !== undefined) {
        await recomputeReceiptTotals(prisma, receiptId);
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
