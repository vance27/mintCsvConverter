export interface MatchByAmountAndStoreOptions<T> {
    payer: string;
    description: string;
    amount: number;
    /** ISO date (or anything Date.parse understands) to tiebreak against. */
    targetDate: string;
    getPayer: (candidate: T) => string;
    getStore: (candidate: T) => string;
    getAmount: (candidate: T) => number;
    /** ISO date (or anything Date.parse understands) for the candidate. */
    getPurchaseDate: (candidate: T) => string;
    /** Dollar slop allowed between `amount` and a candidate's amount. Defaults to a cent. */
    toleranceDollars?: number;
}

/**
 * Shape-agnostic core shared by automation's manifestMatch.ts and
 * receipt-review's transactionReceiptMatch.ts: filters candidates to the
 * same payer (case-insensitive), a store name that's a substring of the
 * description (case-insensitive), and an amount within tolerance, then
 * tiebreaks multiple matches by closest purchase date. Returns null (never
 * throws) when there's no confident match.
 */
export function matchByAmountAndStore<T>(candidates: T[], options: MatchByAmountAndStoreOptions<T>): T | null {
    const tolerance = options.toleranceDollars ?? 0.01;
    const description = options.description.toLowerCase();
    const payer = options.payer.toLowerCase();

    const matches = candidates.filter(
        (candidate) =>
            options.getPayer(candidate).toLowerCase() === payer &&
            description.includes(options.getStore(candidate).toLowerCase()) &&
            Math.abs(options.amount - options.getAmount(candidate)) <= tolerance,
    );

    if (matches.length === 0) {
        return null;
    }
    if (matches.length === 1) {
        return matches[0];
    }

    const targetMs = Date.parse(options.targetDate);
    return matches.reduce((best, candidate) => {
        const bestDelta = Math.abs(Date.parse(options.getPurchaseDate(best)) - targetMs);
        const candidateDelta = Math.abs(Date.parse(options.getPurchaseDate(candidate)) - targetMs);
        return candidateDelta < bestDelta ? candidate : best;
    });
}
