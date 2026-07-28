import { toIsoDate } from '@mint-csv-converter/automation';
import { hasReliableExtraction } from '@mint-csv-converter/receipts/receiptStateMachine';
import type { ReceiptSummary } from './receiptQueries.js';

export interface ReceiptMatch {
    receiptId: number;
    status: ReceiptSummary['status'];
    aggregate: Record<string, number>;
}

// Rounding-error tolerance between a staged transaction amount and a
// receipt's cardAmount — both are decimal dollars, so a cent of float slop
// is enough. Mirrors automation's manifestMatch.ts tolerance.
const AMOUNT_TOLERANCE = 0.01;

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
            hasReliableExtraction(r.status) &&
            r.purchaseDate !== null &&
            r.total !== null &&
            r.payer.toLowerCase() === transaction.payer.toLowerCase() &&
            transaction.description.toLowerCase().includes(r.store.toLowerCase()) &&
            Math.abs(transaction.amount - (r.cardAmount ?? r.total)) <= AMOUNT_TOLERANCE,
    );

    if (candidates.length === 0) {
        return null;
    }
    if (candidates.length === 1) {
        return toReceiptMatch(candidates[0]);
    }

    const transactionMs = Date.parse(toIsoDate(transaction.date));
    const closest = candidates.reduce((best, r) => {
        const bestDelta = Math.abs(Date.parse(best.purchaseDate) - transactionMs);
        const rDelta = Math.abs(Date.parse(r.purchaseDate) - transactionMs);
        return rDelta < bestDelta ? r : best;
    });
    return toReceiptMatch(closest);
}

function toReceiptMatch(receipt: ReceiptSummary): ReceiptMatch {
    return { receiptId: receipt.id, status: receipt.status, aggregate: receipt.aggregate };
}
