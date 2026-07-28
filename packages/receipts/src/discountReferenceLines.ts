import type { ExtractedLineItem } from './types.js';

/**
 * Deterministic backstop for a real, repeated extraction failure: despite
 * extractReceipt.ts's Costco prompt spelling out the "<code> /<itemCode>
 * <amount>-" discount-line convention with a worked example, a real
 * ingest showed the model still emitting these reference lines as their
 * own bogus items instead of folding them into the referenced item's
 * discountAmount — reliably for the one example demonstrated in the
 * prompt, unreliably for every other occurrence of the same pattern on
 * the same receipt (a many-line-item Costco receipt has several such
 * lines, not just one). Prompt wording alone didn't fix this in
 * practice, so this catches the common case — a reference line whose
 * rawName starts with "/" followed by another item's own itemCode,
 * printed within the same receipt — and folds it in code instead of
 * hoping the model generalizes the rule. A reference line whose target
 * can't be confidently matched (e.g. the referenced item's own code was
 * *also* misread on this receipt) is left alone rather than guessed at;
 * it stays visible as its own item, exactly as reconcile() already
 * surfaces it today, so it can be fixed manually in the review UI
 * (edit price / delete line item).
 */
export function foldDiscountReferenceLines(items: ExtractedLineItem[]): ExtractedLineItem[] {
    const byItemCode = new Map<string, ExtractedLineItem>();
    for (const item of items) {
        if (item.itemCode && !byItemCode.has(item.itemCode)) {
            byItemCode.set(item.itemCode, item);
        }
    }

    const folded = new Map<ExtractedLineItem, ExtractedLineItem>();
    const result: ExtractedLineItem[] = [];

    for (const item of items) {
        const referencedCode = extractReferencedCode(item.rawName);
        const target = referencedCode ? byItemCode.get(referencedCode) : undefined;
        if (target && target !== item) {
            const current = folded.get(target) ?? target;
            folded.set(target, { ...current, discountAmount: current.discountAmount + Math.abs(item.lineTotal) });
            continue;
        }
        result.push(item);
    }

    return result.map((item) => folded.get(item) ?? item);
}

/** A discount-reference line's rawName is "/<itemCode>", possibly with surrounding whitespace — e.g. "/2022527". Returns null for an ordinary item name. */
function extractReferencedCode(rawName: string): string | null {
    const match = /^\s*\/\s*([A-Za-z0-9]+)\s*$/.exec(rawName);
    return match ? match[1] : null;
}
