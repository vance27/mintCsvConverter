import { describe, it, expect } from 'vitest';
import { applyColumnMapping, CITI_DEFAULT_MAPPING, type CsvColumnMapping } from './csvColumnMapping.js';

describe('applyColumnMapping', () => {
    it('reproduces CITI_DEFAULT_MAPPING behavior (case-insensitive header names, sign-preserving Debit/Credit)', () => {
        const rawRows = [
            ['Status', 'Date', 'Description', 'Debit', 'Credit', 'Member Name'],
            ['Cleared', '06/29/2026', 'ONLINE PAYMENT, THANK YOU', '', '-3505.42', 'BRIAN K VANCE'],
            ['Cleared', '06/27/2026', "SQ *BRAVI'S CRAFT MEXICAN Shakopee MN", '56.60', '', 'BRIAN K VANCE'],
        ];

        const results = applyColumnMapping(rawRows, CITI_DEFAULT_MAPPING);

        expect(results.length).toBe(3);
        expect(results[1]).toEqual(['06/29/2026', 'ONLINE PAYMENT, THANK YOU', '', '-3505.42']);
        expect(results[2]).toEqual(['06/27/2026', "SQ *BRAVI'S CRAFT MEXICAN Shakopee MN", '', '56.60']);
    });

    it('throws naming every required column when the header is missing one', () => {
        const rawRows = [
            ['Date', 'Description', 'Amount'],
            ['06/20/2024', 'Chipotle', '25.00'],
        ];

        expect(() => applyColumnMapping(rawRows, CITI_DEFAULT_MAPPING)).toThrow(/Date, Description, Debit, and Credit/);
    });

    it('supports a headerless CSV addressed by column index', () => {
        const mapping: CsvColumnMapping = {
            hasHeader: false,
            dateColumn: { byIndex: 0 },
            descriptionColumn: { byIndex: 1 },
            amount: { mode: 'SIGNED_AMOUNT', amountColumn: { byIndex: 2 }, flipSign: false },
        };
        const rawRows = [
            ['06/20/2024', 'Chipotle', '-25.00'],
            ['06/21/2024', 'Paycheck', '1500.00'],
        ];

        const results = applyColumnMapping(rawRows, mapping);

        expect(results.length).toBe(3); // synthesized placeholder row 0 + 2 data rows
        expect(results[1]).toEqual(['06/20/2024', 'Chipotle', '', '-25.00']);
        expect(results[2]).toEqual(['06/21/2024', 'Paycheck', '', '1500.00']);
    });

    it('flips the sign of a single Amount column when flipSign is set', () => {
        const mapping: CsvColumnMapping = {
            hasHeader: true,
            dateColumn: { byName: 'date' },
            descriptionColumn: { byName: 'description' },
            amount: { mode: 'SIGNED_AMOUNT', amountColumn: { byName: 'amount' }, flipSign: true },
        };
        const rawRows = [
            ['Date', 'Description', 'Amount'],
            ['06/20/2024', 'Chipotle', '25.00'],
            ['06/21/2024', 'Refund', '-10.00'],
        ];

        const results = applyColumnMapping(rawRows, mapping);

        expect(results[1]).toEqual(['06/20/2024', 'Chipotle', '', '-25.00']);
        expect(results[2]).toEqual(['06/21/2024', 'Refund', '', '10.00']);
    });

    it('returns an empty grid unchanged', () => {
        expect(applyColumnMapping([], CITI_DEFAULT_MAPPING)).toEqual([]);
    });
});
