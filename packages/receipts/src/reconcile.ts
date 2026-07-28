import type { ExtractedReceipt } from './types.js';

/** Default tolerance (dollars) for the reconciliation arithmetic checks. */
export const RECONCILE_TOLERANCE = 0.02;

export interface ReconcileResult {
    /** True when the line-sum→subtotal, subtotal+tax→total, and (if present) tender→total checks all hold. */
    reconciled: boolean;
    /** Σ(lineTotal − discountAmount) across items. */
    lineSum: number;
    /** lineSum − subtotal (≈ 0 when consistent). */
    subtotalDelta: number;
    /** (subtotal + tax) − total (≈ 0 when consistent). */
    totalDelta: number;
    /** Σ tender amounts − total (≈ 0 when consistent); null when no tenders were extracted. */
    tenderDelta: number | null;
}

/**
 * Deterministic arithmetic check on an extracted receipt — the safety net
 * that makes an imperfect VLM acceptable. We never trust the model for math:
 * the receipt's own numbers must be internally consistent
 * (Σ line totals ≈ subtotal, subtotal + tax ≈ total, and — when a tender
 * breakdown was extracted — Σ tenders ≈ total). A receipt that fails to
 * reconcile is flagged low-confidence so review can surface it first,
 * rather than a misread digit propagating silently.
 */
export function reconcile(receipt: ExtractedReceipt, tolerance: number = RECONCILE_TOLERANCE): ReconcileResult {
    const lineSum = receipt.items.reduce((sum, item) => sum + (item.lineTotal - item.discountAmount), 0);
    const subtotalDelta = lineSum - receipt.subtotal;
    const totalDelta = receipt.subtotal + receipt.tax - receipt.total;
    const tender = tendersReconcile(receipt.tenders, receipt.total, tolerance);
    const reconciled = Math.abs(subtotalDelta) <= tolerance && Math.abs(totalDelta) <= tolerance && tender.reconciled;
    return { reconciled, lineSum, subtotalDelta, totalDelta, tenderDelta: tender.delta };
}

export interface TenderReconcileResult {
    /** Σ tenders − target; null when there were no tenders to check. */
    delta: number | null;
    reconciled: boolean;
}

/**
 * Shared by reconcile() (checking an extraction's own tenders against its
 * own total) and receipt-review's recomputeReceiptTotals (checking a
 * receipt's untouched tenders against a post-edit total) — the same
 * "does this set of tenders sum to the target, within tolerance"
 * predicate, applied to two different targets.
 */
export function tendersReconcile(
    tenders: { amount: number }[],
    target: number,
    tolerance: number = RECONCILE_TOLERANCE,
): TenderReconcileResult {
    if (tenders.length === 0) {
        return { delta: null, reconciled: true };
    }
    const delta = tenders.reduce((sum, tender) => sum + tender.amount, 0) - target;
    return { delta, reconciled: Math.abs(delta) <= tolerance };
}

function describeDelta(delta: number, aLabel: string, bLabel: string): string {
    return `${aLabel} is $${Math.abs(delta).toFixed(2)} ${delta > 0 ? 'higher' : 'lower'} than ${bLabel}`;
}

/**
 * Names which specific check(s) failed reconciliation, for surfacing in the
 * review UI instead of a generic "low confidence" warning (see docs/adr/0006).
 * Returns null when everything's within tolerance — including a receipt with
 * no tender breakdown at all, since tenderDelta is only ever checked when
 * non-null.
 */
export function describeReconcileMismatch(
    result: ReconcileResult,
    tolerance: number = RECONCILE_TOLERANCE,
): string | null {
    const problems: string[] = [];
    if (Math.abs(result.subtotalDelta) > tolerance) {
        problems.push(describeDelta(result.subtotalDelta, 'Line items sum', 'the subtotal'));
    }
    if (Math.abs(result.totalDelta) > tolerance) {
        problems.push(describeDelta(result.totalDelta, 'Subtotal + tax', 'the total'));
    }
    if (result.tenderDelta !== null && Math.abs(result.tenderDelta) > tolerance) {
        problems.push(describeDelta(result.tenderDelta, 'Tenders sum', 'the total'));
    }
    return problems.length > 0 ? problems.join('; ') : null;
}
