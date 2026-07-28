import { describe, it, expect } from 'vitest';
import { ReceiptStatus } from '@mint-csv-converter/receipts';
import { matchTransactionToReceipt } from './transactionReceiptMatch.js';
import type { ReceiptSummary } from './receiptQueries.js';

function receipt(overrides: Partial<ReceiptSummary> = {}): ReceiptSummary {
    return {
        id: 1,
        store: 'Costco',
        payer: 'Brian',
        createdAt: '2026-06-20T00:00:00.000Z',
        purchaseDate: '2026-06-20T00:00:00.000Z',
        total: 150.0,
        cardAmount: 150.0,
        reconciled: true,
        status: ReceiptStatus.SUBMITTED,
        submittedAt: '2026-06-21T00:00:00.000Z',
        lineItemCount: 3,
        aggregate: { Brian: 62, Patrice: 38 },
        originalFilename: 'receipt.pdf',
        extractionError: null,
        queuePosition: null,
        model: 'qwen2.5vl:32b',
        ...overrides,
    };
}

const TRANSACTION = { payer: 'Brian', description: 'Costco Wholesale', date: '06/20/2026', amount: 150.0 };

describe('matchTransactionToReceipt', () => {
    it('matches on store, payer, and amount', () => {
        expect(matchTransactionToReceipt(TRANSACTION, [receipt()])).toEqual({
            receiptId: 1,
            status: ReceiptStatus.SUBMITTED,
            aggregate: { Brian: 62, Patrice: 38 },
        });
    });

    it('tolerates a cent of float rounding slop', () => {
        expect(matchTransactionToReceipt(TRANSACTION, [receipt({ cardAmount: 150.005 })])).not.toBeNull();
    });

    it('falls back to total when cardAmount is null', () => {
        expect(matchTransactionToReceipt(TRANSACTION, [receipt({ cardAmount: null, total: 150.0 })])).not.toBeNull();
    });

    it('returns null when no receipt matches the payer', () => {
        expect(matchTransactionToReceipt(TRANSACTION, [receipt({ payer: 'Patrice' })])).toBeNull();
    });

    it('returns null when no receipt matches the store', () => {
        expect(matchTransactionToReceipt(TRANSACTION, [receipt({ store: 'Target' })])).toBeNull();
    });

    it('returns null when the amount is outside tolerance', () => {
        expect(matchTransactionToReceipt(TRANSACTION, [receipt({ cardAmount: 151.0 })])).toBeNull();
    });

    it('returns null with no receipts', () => {
        expect(matchTransactionToReceipt(TRANSACTION, [])).toBeNull();
    });

    it('excludes QUEUED/EXTRACTING/FAILED placeholder rows even if the amount would otherwise match', () => {
        const placeholder = receipt({
            status: ReceiptStatus.EXTRACTING,
            purchaseDate: null,
            total: null,
            cardAmount: null,
        });
        expect(matchTransactionToReceipt(TRANSACTION, [placeholder])).toBeNull();
    });

    it('tiebreaks multiple same-amount candidates by closest purchaseDate', () => {
        const near = receipt({ id: 1, purchaseDate: '2026-06-19T00:00:00.000Z', aggregate: { Brian: 10, Patrice: 90 } });
        const far = receipt({ id: 2, purchaseDate: '2026-05-01T00:00:00.000Z', aggregate: { Brian: 99, Patrice: 1 } });
        expect(matchTransactionToReceipt(TRANSACTION, [far, near])).toEqual({
            receiptId: 1,
            status: ReceiptStatus.SUBMITTED,
            aggregate: { Brian: 10, Patrice: 90 },
        });
    });
});
