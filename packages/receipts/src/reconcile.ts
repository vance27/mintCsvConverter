import type { ExtractedReceipt } from './types.js';

/** Default tolerance (dollars) for the reconciliation arithmetic checks. */
export const RECONCILE_TOLERANCE = 0.02;

export interface ReconcileResult {
  /** True when both the line-sum→subtotal and subtotal+tax→total checks hold. */
  reconciled: boolean;
  /** Σ(lineTotal − discountAmount) across items. */
  lineSum: number;
  /** lineSum − subtotal (≈ 0 when consistent). */
  subtotalDelta: number;
  /** (subtotal + tax) − total (≈ 0 when consistent). */
  totalDelta: number;
}

/**
 * Deterministic arithmetic check on an extracted receipt — the safety net
 * that makes an imperfect VLM acceptable. We never trust the model for math:
 * the receipt's own numbers must be internally consistent
 * (Σ line totals ≈ subtotal, and subtotal + tax ≈ total). A receipt that
 * fails to reconcile is flagged low-confidence so review can surface it
 * first, rather than a misread digit propagating silently.
 */
export function reconcile(receipt: ExtractedReceipt, tolerance: number = RECONCILE_TOLERANCE): ReconcileResult {
  const lineSum = receipt.items.reduce((sum, item) => sum + (item.lineTotal - item.discountAmount), 0);
  const subtotalDelta = lineSum - receipt.subtotal;
  const totalDelta = receipt.subtotal + receipt.tax - receipt.total;
  const reconciled = Math.abs(subtotalDelta) <= tolerance && Math.abs(totalDelta) <= tolerance;
  return { reconciled, lineSum, subtotalDelta, totalDelta };
}
