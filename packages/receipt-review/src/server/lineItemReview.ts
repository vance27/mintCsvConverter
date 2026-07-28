import { z } from 'zod';
import { resolveItem, type ExtractedLineItem, type PrismaClient } from '@mint-csv-converter/receipts';
import { recomputeReceiptTotals, round2 } from './receiptTotals.js';

export const updateLineItemSplitsSchema = z.object({
    splits: z.record(z.string(), z.number().min(0).max(100)),
    displayName: z.string().min(1).optional(),
    /** Reviewer-corrected "what was actually paid" for this line — derives discountAmount against the (possibly also-corrected) lineTotal. */
    netPrice: z.number().min(0).optional(),
    /** Corrected printed unit price — recomputes lineTotal and syncs the line's PriceObservation. */
    unitPrice: z.number().min(0).optional(),
    /** Corrected printed quantity — recomputes lineTotal and syncs the line's PriceObservation. */
    quantity: z.number().positive().optional(),
    /** Eyeball-only against the printed receipt — no tax-rate computation reads this. Null clears a prior taxable/non-taxable read. */
    taxable: z.boolean().nullable().optional(),
});

export type UpdateLineItemSplitsInput = z.infer<typeof updateLineItemSplitsSchema>;

export const addLineItemSchema = z.object({
    itemCode: z.string().min(1).nullable().optional(),
    rawName: z.string().min(1),
    unitPrice: z.number().min(0),
    quantity: z.number().positive(),
    taxable: z.boolean().nullable().optional(),
});

export type AddLineItemInput = z.infer<typeof addLineItemSchema>;

export const updateLineItemCodeSchema = z.object({
    itemCode: z.string().min(1),
});

export class SplitsSumError extends Error {
    constructor(total: number) {
        super(`Splits must sum to 100, got ${total}`);
    }
}

/**
 * Saves one line item's reviewed splits (and optional item display-name
 * rename / corrected price/quantity/taxable), marking the line reviewed.
 * Split-sum validation happens here (not just at the zod-schema level) since
 * the valid sum depends on which participants are present, not a fixed
 * shape. unitPrice/quantity edits recompute lineTotal = unitPrice × quantity
 * and sync the line's existing PriceObservation to match — a corrected price
 * with a permanently-wrong price-history entry sitting next to it would be
 * worse than not correcting it at all (docs/adr/0009).
 */
export async function updateLineItemSplits(
    prisma: PrismaClient,
    lineItemId: number,
    input: UpdateLineItemSplitsInput,
): Promise<void> {
    const total = Object.values(input.splits).reduce((sum, percent) => sum + percent, 0);
    if (Math.round(total) !== 100) {
        throw new SplitsSumError(total);
    }

    const lineItem = await prisma.lineItem.findUniqueOrThrow({ where: { id: lineItemId } });
    const participants = await prisma.participant.findMany({ where: { name: { in: Object.keys(input.splits) } } });

    const priceChanged = input.unitPrice !== undefined || input.quantity !== undefined;
    const unitPrice = input.unitPrice ?? lineItem.unitPrice;
    const quantity = input.quantity ?? lineItem.quantity;
    const lineTotal = priceChanged ? round2(unitPrice * quantity) : lineItem.lineTotal;

    await prisma.$transaction(async (tx) => {
        for (const participant of participants) {
            await tx.lineItemSplit.upsert({
                where: { lineItemId_participantId: { lineItemId, participantId: participant.id } },
                create: { lineItemId, participantId: participant.id, percent: input.splits[participant.name] },
                update: { percent: input.splits[participant.name] },
            });
        }
        await tx.lineItem.update({
            where: { id: lineItemId },
            data: {
                reviewed: true,
                ...(priceChanged ? { unitPrice, quantity, lineTotal } : {}),
                ...(input.netPrice !== undefined ? { discountAmount: round2(lineTotal - input.netPrice) } : {}),
                ...(input.taxable !== undefined ? { taxable: input.taxable } : {}),
            },
        });
        if (input.displayName && lineItem.itemId) {
            await tx.item.update({ where: { id: lineItem.itemId }, data: { displayName: input.displayName } });
        }
        if (priceChanged && lineItem.itemId) {
            // PriceObservation is keyed on (itemId, receiptId), not on a specific
            // LineItem — findFirst rather than updateMany so two distinct lines
            // for the same item on one receipt (rare, but the schema allows it)
            // don't both get overwritten by one edit.
            const observation = await tx.priceObservation.findFirst({
                where: { receiptId: lineItem.receiptId, itemId: lineItem.itemId },
            });
            if (observation) {
                await tx.priceObservation.update({ where: { id: observation.id }, data: { unitPrice, quantity } });
            }
        }
    });

    if (input.netPrice !== undefined || priceChanged) {
        await recomputeReceiptTotals(prisma, lineItem.receiptId);
    }
}

/**
 * Adds a line item the VLM missed entirely, resolving it against the
 * receipt's own store exactly the way ingest.ts's per-item loop does (same
 * shared resolveItem) — so a hand-added line inherits a learned
 * ItemSplitDefault exactly like an extracted one, and gets its own
 * PriceObservation dated to the receipt's purchaseDate, counting toward that
 * item's price-history the same way (docs/adr/0009).
 */
export async function addLineItem(prisma: PrismaClient, receiptId: number, input: AddLineItemInput): Promise<void> {
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    const activeParticipants = await prisma.participant.findMany({ where: { active: true }, orderBy: { id: 'asc' } });

    const extractedItem: ExtractedLineItem = {
        itemCode: input.itemCode ?? null,
        rawName: input.rawName,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        lineTotal: round2(input.unitPrice * input.quantity),
        taxable: input.taxable ?? null,
        discountAmount: 0,
    };
    const { item, splitPercents } = await resolveItem(prisma, receipt.storeId, extractedItem, activeParticipants);
    const observedAt = receipt.purchaseDate ?? receipt.createdAt;

    await prisma.$transaction(async (tx) => {
        const lineItem = await tx.lineItem.create({
            data: {
                receiptId,
                itemId: item.id,
                rawItemCode: extractedItem.itemCode,
                rawName: extractedItem.rawName,
                unitPrice: extractedItem.unitPrice,
                quantity: extractedItem.quantity,
                lineTotal: extractedItem.lineTotal,
                taxable: extractedItem.taxable,
            },
        });
        await tx.lineItemSplit.createMany({
            data: activeParticipants.map((participant, i) => ({
                lineItemId: lineItem.id,
                participantId: participant.id,
                percent: splitPercents[i],
            })),
        });
        await tx.priceObservation.create({
            data: {
                itemId: item.id,
                receiptId,
                unitPrice: extractedItem.unitPrice,
                quantity: extractedItem.quantity,
                observedAt,
            },
        });
        await tx.item.update({ where: { id: item.id }, data: { lastSeenName: extractedItem.rawName } });
    });

    await recomputeReceiptTotals(prisma, receiptId);
}

/**
 * Re-resolves a line item against a corrected item code — e.g. an OCR
 * misread the reviewer noticed against the printed receipt — moving its
 * existing PriceObservation to the newly-matched Item. Deliberately leaves
 * LineItemSplit rows untouched: a reviewer who already adjusted this line's
 * split before noticing the code was wrong shouldn't have that work silently
 * clobbered by an unrelated code fix (docs/adr/0009).
 */
export async function updateLineItemCode(prisma: PrismaClient, lineItemId: number, itemCode: string): Promise<void> {
    const lineItem = await prisma.lineItem.findUniqueOrThrow({ where: { id: lineItemId } });
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: lineItem.receiptId } });
    const activeParticipants = await prisma.participant.findMany({ where: { active: true }, orderBy: { id: 'asc' } });

    const extractedItem: ExtractedLineItem = {
        itemCode,
        rawName: lineItem.rawName,
        quantity: lineItem.quantity,
        unitPrice: lineItem.unitPrice,
        lineTotal: lineItem.lineTotal,
        taxable: lineItem.taxable,
        discountAmount: lineItem.discountAmount,
    };
    const { item } = await resolveItem(prisma, receipt.storeId, extractedItem, activeParticipants);

    await prisma.$transaction(async (tx) => {
        await tx.lineItem.update({ where: { id: lineItemId }, data: { itemId: item.id, rawItemCode: itemCode } });
        if (lineItem.itemId) {
            // Same (itemId, receiptId)-granularity caveat as updateLineItemSplits above.
            const observation = await tx.priceObservation.findFirst({
                where: { receiptId: lineItem.receiptId, itemId: lineItem.itemId },
            });
            if (observation) {
                await tx.priceObservation.update({ where: { id: observation.id }, data: { itemId: item.id } });
            }
        }
        await tx.item.update({ where: { id: item.id }, data: { lastSeenName: lineItem.rawName } });
    });
}

/**
 * Soft-deletes an incorrectly-extracted line item (e.g. a Costco
 * discount-reference line misread as its own item), excluding it from
 * recomputed totals — its LineItemSplit/PriceObservation rows are left
 * alone so restoreLineItem can bring it back exactly as it was. Allowed
 * regardless of Receipt.status, including SUBMITTED, consistent with this
 * app's "resubmit updates in place, latest correction wins" philosophy.
 */
export async function deleteLineItem(prisma: PrismaClient, lineItemId: number): Promise<void> {
    const lineItem = await prisma.lineItem.update({ where: { id: lineItemId }, data: { removedAt: new Date() } });
    await recomputeReceiptTotals(prisma, lineItem.receiptId);
}

/** Undoes deleteLineItem, restoring the line's original split/price to the recomputed totals. */
export async function restoreLineItem(prisma: PrismaClient, lineItemId: number): Promise<void> {
    const lineItem = await prisma.lineItem.update({ where: { id: lineItemId }, data: { removedAt: null } });
    await recomputeReceiptTotals(prisma, lineItem.receiptId);
}
