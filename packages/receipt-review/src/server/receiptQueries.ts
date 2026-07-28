import {
    aggregateSplits,
    ReceiptStatus,
    type AggregateLine,
    type PrismaClient,
    type ReconcileResult,
} from '@mint-csv-converter/receipts';

export interface ReceiptSummary {
    id: number;
    store: string;
    payer: string;
    /** When this receipt was first uploaded/queued — used by the client to show an elapsed-time counter on an EXTRACTING row. */
    createdAt: string;
    /** Null for a not-yet-extracted QUEUED/EXTRACTING/FAILED row. */
    purchaseDate: string | null;
    total: number | null;
    cardAmount: number | null;
    reconciled: boolean;
    status: ReceiptStatus;
    submittedAt: string | null;
    lineItemCount: number;
    /** Current dollar-weighted aggregate split (see aggregateSplits) — the even-split ingest default until reviewed. */
    aggregate: Record<string, number>;
    /** The uploaded file's own name — shown in place of store/date for a row that hasn't been extracted yet. Null for receipts ingested before this field existed. */
    originalFilename: string | null;
    /** Set only when status is FAILED. */
    extractionError: string | null;
    /** 1-based position among other QUEUED rows, oldest first; null for any other status. */
    queuePosition: number | null;
    /** Ollama model this receipt was (or will be) extracted with (docs/adr/0007). */
    model: string;
}

// Explicit priority instead of relying on enum-alphabetical order, now that
// there are 6 statuses: a stuck FAILED or deliberately-CANCELLED row needs
// attention first, EXTRACTING is worth seeing live, QUEUED next, then
// needs-review (EXTRACTED, itself sub-sorted by reconciled/purchaseDate
// below), SUBMITTED last.
const STATUS_PRIORITY: Record<ReceiptStatus, number> = {
    [ReceiptStatus.FAILED]: 0,
    [ReceiptStatus.CANCELLED]: 1,
    [ReceiptStatus.EXTRACTING]: 2,
    [ReceiptStatus.QUEUED]: 3,
    [ReceiptStatus.EXTRACTED]: 4,
    [ReceiptStatus.SUBMITTED]: 5,
};

/**
 * All receipts, one list: FAILED/EXTRACTING/QUEUED rows first (in that
 * order, so a stuck upload is impossible to miss), then needs-review
 * (EXTRACTED, unreconciled first, then oldest purchaseDate first), then
 * SUBMITTED last.
 */
export async function listReceipts(prisma: PrismaClient): Promise<ReceiptSummary[]> {
    const receipts = await prisma.receipt.findMany({
        include: {
            store: true,
            payer: true,
            _count: { select: { lineItems: { where: { removedAt: null } } } },
            lineItems: { where: { removedAt: null }, include: { splits: { include: { participant: true } } } },
        },
    });

    const queuedByAge = receipts
        .filter((r) => r.status === ReceiptStatus.QUEUED)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const queuePositionById = new Map(queuedByAge.map((r, i) => [r.id, i + 1]));

    const summaries = receipts.map((r) => {
        const participantNames = [...new Set(r.lineItems.flatMap((li) => li.splits.map((s) => s.participant.name)))];
        // aggregateSplits over zero line items (a placeholder row) returns
        // all-zero shares — safe, no special-casing needed here.
        const aggregateLines: AggregateLine[] = r.lineItems.map((li) => ({
            lineTotal: li.lineTotal,
            discountAmount: li.discountAmount,
            splits: Object.fromEntries(li.splits.map((s) => [s.participant.name, s.percent])),
        }));
        return {
            id: r.id,
            store: r.store.name,
            payer: r.payer.name,
            createdAt: r.createdAt.toISOString(),
            purchaseDate: r.purchaseDate ? r.purchaseDate.toISOString() : null,
            total: r.total,
            cardAmount: r.cardAmount,
            reconciled: r.reconciled,
            status: r.status,
            submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
            lineItemCount: r._count.lineItems,
            aggregate: aggregateSplits(aggregateLines, participantNames),
            originalFilename: r.originalFilename,
            extractionError: r.extractionError,
            queuePosition: queuePositionById.get(r.id) ?? null,
            model: r.model,
        };
    });

    return summaries.sort((a, b) => {
        const priorityDelta = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
        if (priorityDelta !== 0) {
            return priorityDelta;
        }
        if (a.status === ReceiptStatus.QUEUED) {
            return (a.queuePosition ?? 0) - (b.queuePosition ?? 0);
        }
        if (a.reconciled !== b.reconciled) {
            return a.reconciled ? 1 : -1;
        }
        return (a.purchaseDate ?? '').localeCompare(b.purchaseDate ?? '');
    });
}

export interface PriceHistory {
    previousUnitPrice: number | null;
    /** Percent change vs. the most recent prior observation; null when there's no prior observation to compare against. */
    changePercent: number | null;
}

export interface LineItemDetail {
    id: number;
    itemId: number | null;
    rawItemCode: string | null;
    rawName: string;
    displayName: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    discountAmount: number;
    reviewed: boolean;
    /** The VLM's (or a reviewer's) read of whether this line is taxable — null means unset/unknown, never a false claim (docs/adr/0009). */
    taxable: boolean | null;
    /** Set when this line has been soft-deleted (lineItemReview.ts's deleteLineItem) — kept in this array (rather than excluded) so the client can render it struck-through with a Restore action. */
    removedAt: string | null;
    splits: Record<string, number>;
    priceHistory: PriceHistory;
    /** Whether this item already had a learned typical split before this receipt. */
    provenance: 'new' | 'learned';
}

export interface ReceiptDetail {
    id: number;
    store: string;
    payer: string;
    purchaseDate: string | null;
    subtotal: number | null;
    tax: number | null;
    total: number | null;
    cardAmount: number | null;
    reconciled: boolean;
    /** The full arithmetic breakdown behind `reconciled` — null for a receipt ingested before this field existed, or not yet extracted. */
    reconcile: ReconcileResult | null;
    status: ReceiptStatus;
    submittedAt: string | null;
    originalFilename: string | null;
    extractionError: string | null;
    /** The VLM's own store reading, straight off the receipt image — null when it couldn't read one, or not yet extracted (docs/adr/0004). */
    extractedStoreName: string | null;
    /** Ollama model this receipt was (or will be) extracted with (docs/adr/0007). */
    model: string;
    tenders: { kind: string; label: string; amount: number }[];
    lineItems: LineItemDetail[];
}

export async function getReceiptDetail(prisma: PrismaClient, receiptId: number): Promise<ReceiptDetail | null> {
    const receipt = await prisma.receipt.findUnique({
        where: { id: receiptId },
        include: {
            store: true,
            payer: true,
            tenders: true,
            lineItems: { include: { item: true, splits: { include: { participant: true } } } },
        },
    });
    if (!receipt) {
        return null;
    }

    const lineItems: LineItemDetail[] = [];
    for (const lineItem of receipt.lineItems) {
        let priceHistory: PriceHistory = { previousUnitPrice: null, changePercent: null };
        let provenance: 'new' | 'learned' = 'new';

        if (lineItem.itemId) {
            const [previousObservation, defaultCount] = await Promise.all([
                prisma.priceObservation.findFirst({
                    where: { itemId: lineItem.itemId, receiptId: { not: receiptId } },
                    orderBy: { observedAt: 'desc' },
                }),
                prisma.itemSplitDefault.count({ where: { itemId: lineItem.itemId } }),
            ]);
            provenance = defaultCount > 0 ? 'learned' : 'new';
            if (previousObservation) {
                priceHistory = {
                    previousUnitPrice: previousObservation.unitPrice,
                    changePercent:
                        previousObservation.unitPrice > 0
                            ? ((lineItem.unitPrice - previousObservation.unitPrice) / previousObservation.unitPrice) *
                              100
                            : null,
                };
            }
        }

        lineItems.push({
            id: lineItem.id,
            itemId: lineItem.itemId,
            rawItemCode: lineItem.rawItemCode,
            rawName: lineItem.rawName,
            displayName: lineItem.item?.displayName ?? null,
            unitPrice: lineItem.unitPrice,
            quantity: lineItem.quantity,
            lineTotal: lineItem.lineTotal,
            discountAmount: lineItem.discountAmount,
            reviewed: lineItem.reviewed,
            taxable: lineItem.taxable,
            removedAt: lineItem.removedAt ? lineItem.removedAt.toISOString() : null,
            splits: Object.fromEntries(lineItem.splits.map((s) => [s.participant.name, s.percent])),
            priceHistory,
            provenance,
        });
    }

    return {
        id: receipt.id,
        store: receipt.store.name,
        payer: receipt.payer.name,
        purchaseDate: receipt.purchaseDate ? receipt.purchaseDate.toISOString() : null,
        subtotal: receipt.subtotal,
        tax: receipt.tax,
        total: receipt.total,
        cardAmount: receipt.cardAmount,
        reconciled: receipt.reconciled,
        reconcile: receipt.reconcileJson ? (JSON.parse(receipt.reconcileJson) as ReconcileResult) : null,
        status: receipt.status,
        submittedAt: receipt.submittedAt ? receipt.submittedAt.toISOString() : null,
        originalFilename: receipt.originalFilename,
        extractionError: receipt.extractionError,
        extractedStoreName: receipt.extractedStoreName,
        model: receipt.model,
        tenders: receipt.tenders.map((t) => ({ kind: t.kind, label: t.label, amount: t.amount })),
        lineItems,
    };
}
