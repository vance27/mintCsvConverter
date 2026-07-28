/**
 * Mirrors the Prisma-generated ReceiptStatus enum as a plain string-literal
 * union so this module (and its client-side importers, via the
 * ./receiptStateMachine subpath) has zero dependency on generated Prisma
 * output — Prisma's real enum values are structurally assignable here, no
 * casts needed at server call sites.
 */
export type ReceiptStatusLike = 'QUEUED' | 'EXTRACTING' | 'EXTRACTED' | 'SUBMITTED' | 'FAILED';

/** Still being enqueued/extracted — no reliable total/cardAmount/purchaseDate yet. */
export function isPending(status: ReceiptStatusLike): boolean {
    return status === 'QUEUED' || status === 'EXTRACTING';
}

/** Has gone through extraction at least once, so its numbers are safe to match/aggregate on. */
export function hasReliableExtraction(status: ReceiptStatusLike): boolean {
    return status === 'EXTRACTED' || status === 'SUBMITTED';
}

/** A stuck extraction that can be reset back to QUEUED and reused. */
export function canRetry(status: ReceiptStatusLike): boolean {
    return status === 'FAILED';
}
