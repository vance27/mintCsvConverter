/**
 * Whether the VLM's own store reading (Receipt.extractedStoreName) conflicts
 * with the user-declared Store. Receipts rarely print the exact declared
 * name (e.g. declared "Costco" prints as "COSTCO WHOLESALE #123"), so this
 * is a case-insensitive substring check in either direction rather than an
 * exact match — see docs/adr/0004. `null` (the model couldn't read a store
 * name at all) is never a disagreement, to avoid a false-positive warning on
 * every low-confidence extraction.
 */
export function storeNamesDisagree(declaredStore: string, extractedStoreName: string | null): boolean {
    if (extractedStoreName === null) {
        return false;
    }
    const declared = normalize(declaredStore);
    const extracted = normalize(extractedStoreName);
    if (!declared || !extracted) {
        return false;
    }
    return !extracted.includes(declared) && !declared.includes(extracted);
}

function normalize(value: string): string {
    return value.trim().toLowerCase();
}
