import { extractReceipt, type ExtractReceiptOptions } from './extractReceipt.js';
import { reconcile, type ReconcileResult } from './reconcile.js';
import type { VisionChatClient } from './ollamaClient.js';
import type { ExtractedReceipt } from './types.js';

/**
 * Extraction attempts before giving up and keeping the last (still
 * low-confidence-flagged) result. Defaults to 1 — a single VLM call, no
 * automatic re-extraction on a reconciliation failure — because each
 * attempt costs ~2-3 minutes of local VLM time, and the review UI already
 * lets a reviewer edit or delete a misread line item directly (see
 * ReceiptReviewPage), which is a cheaper fix than re-running the whole
 * extraction speculatively. Callers that still want the old
 * retry-until-reconciled behavior can pass a higher `maxAttempts` explicitly.
 */
export const MAX_EXTRACTION_ATTEMPTS = 1;

export interface ExtractReconciledResult {
  receipt: ExtractedReceipt;
  reconcile: ReconcileResult;
  /** How many extraction calls it took — 1 means it reconciled on the first try. */
  attempts: number;
}

/**
 * Extracts a receipt, optionally retrying (re-rendering and re-asking the
 * VLM from scratch, up to `maxAttempts`) whenever the result fails
 * `reconcile`'s arithmetic check — the VLM isn't perfectly deterministic, so
 * a second read sometimes gets a misattributed quantity annotation right
 * where the first didn't. Never blocks: if no attempt reconciles, the last
 * attempt is returned anyway, still flagged low-confidence for review.
 */
export async function extractReconciledReceipt(
  pdfPath: string,
  client: VisionChatClient,
  options: ExtractReceiptOptions = {},
  maxAttempts: number = MAX_EXTRACTION_ATTEMPTS,
): Promise<ExtractReconciledResult> {
  let last: { receipt: ExtractedReceipt; reconcile: ReconcileResult } | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[extract] attempt ${attempt}/${maxAttempts}`);
    const receipt = await extractReceipt(pdfPath, client, options);
    const reconcileResult = reconcile(receipt);
    last = { receipt, reconcile: reconcileResult };
    if (reconcileResult.reconciled) {
      console.log(`[extract] attempt ${attempt} reconciled`);
      return { ...last, attempts: attempt };
    }
    console.log(
      `[extract] attempt ${attempt} did not reconcile — subtotalDelta=${reconcileResult.subtotalDelta.toFixed(2)} totalDelta=${reconcileResult.totalDelta.toFixed(2)}${
        reconcileResult.tenderDelta === null ? '' : ` tenderDelta=${reconcileResult.tenderDelta.toFixed(2)}`
      }`,
    );
  }

  return { ...last!, attempts: maxAttempts };
}
