import { toIsoDate } from '@mint-csv-converter/automation';
import { matchByAmountAndStore } from '@mint-csv-converter/receipts';
import { hasReliableExtraction } from '@mint-csv-converter/receipts/receiptStateMachine';
import type { ReceiptSummary } from './receiptQueries.js';

export interface ReceiptMatch {
    receiptId: number;
    status: ReceiptSummary['status'];
    aggregate: Record<string, number>;
}

/**
 * Matches a 'Variably' ImportedTransaction against the live Receipt table
 * (via already-computed ReceiptSummary rows — see receiptQueries.ts's
 * listReceipts, which already includes every receipt regardless of
 * status), so an unsubmitted receipt shows up here too — unlike
 * automation's matchManifestEntry, which only sees submitted ones via the
 * manifest file. Same amount-primary matching idea: filter to payer +
 * store-name-substring-of-description + cardAmount within a cent,
 * tiebreak multiple candidates by closest purchaseDate. Returns null
 * (never throws) when there's no confident match.
 */
export function matchTransactionToReceipt(
    transaction: { payer: string; description: string; date: string; amount: number },
    receipts: ReceiptSummary[],
): ReceiptMatch | null {
    const candidates = receipts.filter(
        (r): r is ReceiptSummary & { purchaseDate: string; total: number } =>
            // A QUEUED/EXTRACTING/FAILED placeholder row has no reliable
            // cardAmount/total/purchaseDate yet — without this guard,
            // `r.cardAmount ?? r.total` on such a row would be null, and the
            // amount-difference check below would coerce that to 0, producing
            // false-positive matches against receipts still mid-extraction.
            hasReliableExtraction(r.status) && r.purchaseDate !== null && r.total !== null,
    );

    const match = matchByAmountAndStore(candidates, {
        payer: transaction.payer,
        description: transaction.description,
        amount: transaction.amount,
        targetDate: toIsoDate(transaction.date),
        getPayer: (r) => r.payer,
        getStore: (r) => r.store,
        getAmount: (r) => r.cardAmount ?? r.total,
        getPurchaseDate: (r) => r.purchaseDate,
    });
    return match ? toReceiptMatch(match) : null;
}

function toReceiptMatch(receipt: ReceiptSummary): ReceiptMatch {
    return { receiptId: receipt.id, status: receipt.status, aggregate: receipt.aggregate };
}
