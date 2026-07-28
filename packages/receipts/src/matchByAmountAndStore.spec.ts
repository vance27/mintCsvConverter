import { describe, it, expect } from 'vitest';
import { matchByAmountAndStore, type MatchByAmountAndStoreOptions } from './matchByAmountAndStore.js';

interface Candidate {
    id: number;
    payer: string;
    store: string;
    amount: number;
    purchaseDate: string;
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
    return { id: 1, payer: 'Brian', store: 'Costco', amount: 150.0, purchaseDate: '2026-06-20', ...overrides };
}

function baseOptions(overrides: Partial<MatchByAmountAndStoreOptions<Candidate>> = {}): MatchByAmountAndStoreOptions<Candidate> {
    return {
        payer: 'Brian',
        description: 'Costco Wholesale',
        amount: 150.0,
        targetDate: '2026-06-20',
        getPayer: (c) => c.payer,
        getStore: (c) => c.store,
        getAmount: (c) => c.amount,
        getPurchaseDate: (c) => c.purchaseDate,
        ...overrides,
    };
}

describe('matchByAmountAndStore', () => {
    it('matches on store, payer, and amount', () => {
        expect(matchByAmountAndStore([candidate()], baseOptions())).toEqual(candidate());
    });

    it('tolerates a cent of float rounding slop', () => {
        expect(matchByAmountAndStore([candidate({ amount: 150.005 })], baseOptions())).toEqual(candidate({ amount: 150.005 }));
    });

    it('returns null when no candidate matches the payer', () => {
        expect(matchByAmountAndStore([candidate({ payer: 'Patrice' })], baseOptions())).toBeNull();
    });

    it('returns null when no candidate matches the store', () => {
        expect(matchByAmountAndStore([candidate({ store: 'Target' })], baseOptions())).toBeNull();
    });

    it('returns null when the amount is outside tolerance', () => {
        expect(matchByAmountAndStore([candidate({ amount: 151.0 })], baseOptions())).toBeNull();
    });

    it('returns null with no candidates', () => {
        expect(matchByAmountAndStore([], baseOptions())).toBeNull();
    });

    it('tiebreaks multiple same-amount candidates by closest purchase date', () => {
        const near = candidate({ id: 1, purchaseDate: '2026-06-19' });
        const far = candidate({ id: 2, purchaseDate: '2026-05-01' });
        expect(matchByAmountAndStore([far, near], baseOptions())).toEqual(near);
    });

    it('respects a custom toleranceDollars', () => {
        expect(matchByAmountAndStore([candidate({ amount: 150.5 })], baseOptions({ toleranceDollars: 1 }))).toEqual(
            candidate({ amount: 150.5 }),
        );
    });
});
