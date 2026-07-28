/**
 * Deterministic normalization of a raw receipt item name into a dedup key,
 * used only as a fallback when a line has no usable item code. Uppercases,
 * strips punctuation/noise, and collapses whitespace so trivially-different
 * printings of the same item ("Org Bananas" / "ORG  BANANAS.") map together.
 *
 * Item-code matching is always preferred when a code is present; this is the
 * best-effort fallback for stores/lines that don't print codes.
 */
export function normalizeItemName(rawName: string): string {
    return rawName
        .toUpperCase()
        .replace(/[^A-Z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
