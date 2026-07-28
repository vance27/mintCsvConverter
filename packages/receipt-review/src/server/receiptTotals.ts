import { RECONCILE_TOLERANCE, type PrismaClient } from '@mint-csv-converter/receipts';

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * Recomputes Receipt.subtotal/total/reconciled from its CURRENT set of
 * LineItems — these fields are otherwise written once at ingest time
 * (ingest.ts) and never revisited, so a reviewer editing a line item's
 * price or deleting a bogus one would otherwise leave them silently stale.
 * `tax` is left untouched: it isn't decomposed per line, so there's no
 * principled way to adjust it from a line-level edit.
 *
 * subtotal/total are now *defined* as sum(lineTotal - discountAmount) + tax,
 * so the subtotal-vs-lineSum and total-vs-subtotal+tax checks reconcile()
 * normally runs at ingest time are tautologically true here by
 * construction — recomputing them would tell us nothing. The only check
 * still meaningful post-edit is whether the (untouched, actually-paid)
 * tender breakdown still sums to the corrected total, so that's what
 * "reconciled" reflects here instead of a full reconcile() call.
 */
export async function recomputeReceiptTotals(prisma: PrismaClient, receiptId: number): Promise<void> {
    const [lineItems, tenders, receipt] = await Promise.all([
        prisma.lineItem.findMany({ where: { receiptId } }),
        prisma.receiptTender.findMany({ where: { receiptId } }),
        prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } }),
    ]);

    const subtotal = round2(lineItems.reduce((sum, li) => sum + (li.lineTotal - li.discountAmount), 0));
    const total = round2(subtotal + (receipt.tax ?? 0));
    const tenderSum = tenders.reduce((sum, t) => sum + t.amount, 0);
    const reconciled = tenders.length === 0 || Math.abs(tenderSum - total) <= RECONCILE_TOLERANCE;

    await prisma.receipt.update({ where: { id: receiptId }, data: { subtotal, total, reconciled } });
}
