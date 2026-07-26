import { aggregateSplits, ReceiptStatus, type AggregateLine, type PrismaClient } from '@mint-csv-converter/receipts';

export interface ReceiptSummary {
  id: number;
  store: string;
  payer: string;
  purchaseDate: string;
  total: number;
  cardAmount: number | null;
  reconciled: boolean;
  status: ReceiptStatus;
  submittedAt: string | null;
  lineItemCount: number;
  /** Current dollar-weighted aggregate split (see aggregateSplits) — the even-split ingest default until reviewed. */
  aggregate: Record<string, number>;
}

/**
 * All receipts, one list: needs-review ones first (EXTRACTED sorts before
 * SUBMITTED alphabetically), then unreconciled (low-confidence) ones, then
 * oldest first.
 */
export async function listReceipts(prisma: PrismaClient): Promise<ReceiptSummary[]> {
  const receipts = await prisma.receipt.findMany({
    orderBy: [{ status: 'asc' }, { reconciled: 'asc' }, { purchaseDate: 'asc' }],
    include: {
      store: true,
      payer: true,
      _count: { select: { lineItems: true } },
      lineItems: { include: { splits: { include: { participant: true } } } },
    },
  });
  return receipts.map((r) => {
    const participantNames = [...new Set(r.lineItems.flatMap((li) => li.splits.map((s) => s.participant.name)))];
    const aggregateLines: AggregateLine[] = r.lineItems.map((li) => ({
      lineTotal: li.lineTotal,
      discountAmount: li.discountAmount,
      splits: Object.fromEntries(li.splits.map((s) => [s.participant.name, s.percent])),
    }));
    return {
      id: r.id,
      store: r.store.name,
      payer: r.payer.name,
      purchaseDate: r.purchaseDate.toISOString(),
      total: r.total,
      cardAmount: r.cardAmount,
      reconciled: r.reconciled,
      status: r.status,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      lineItemCount: r._count.lineItems,
      aggregate: aggregateSplits(aggregateLines, participantNames),
    };
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
  splits: Record<string, number>;
  priceHistory: PriceHistory;
  /** Whether this item already had a learned typical split before this receipt. */
  provenance: 'new' | 'learned';
}

export interface ReceiptDetail {
  id: number;
  store: string;
  payer: string;
  purchaseDate: string;
  subtotal: number;
  tax: number;
  total: number;
  cardAmount: number | null;
  reconciled: boolean;
  status: ReceiptStatus;
  submittedAt: string | null;
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
              ? ((lineItem.unitPrice - previousObservation.unitPrice) / previousObservation.unitPrice) * 100
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
      splits: Object.fromEntries(lineItem.splits.map((s) => [s.participant.name, s.percent])),
      priceHistory,
      provenance,
    });
  }

  return {
    id: receipt.id,
    store: receipt.store.name,
    payer: receipt.payer.name,
    purchaseDate: receipt.purchaseDate.toISOString(),
    subtotal: receipt.subtotal,
    tax: receipt.tax,
    total: receipt.total,
    cardAmount: receipt.cardAmount,
    reconciled: receipt.reconciled,
    status: receipt.status,
    submittedAt: receipt.submittedAt ? receipt.submittedAt.toISOString() : null,
    tenders: receipt.tenders.map((t) => ({ kind: t.kind, label: t.label, amount: t.amount })),
    lineItems,
  };
}
