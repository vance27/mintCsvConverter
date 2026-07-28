import type { ExtractedTender } from './types.js';

/**
 * The portion of a receipt's total that hit a card — the amount that will
 * match a Citi CSV transaction. Falls back to the full total when no tender
 * breakdown was extracted (the common case: paid entirely by card).
 */
export function cardAmount(tenders: ExtractedTender[], total: number): number {
    if (tenders.length === 0) {
        return total;
    }
    return tenders.filter((tender) => tender.kind === 'CARD').reduce((sum, tender) => sum + tender.amount, 0);
}
