import { describe, it, expect } from 'vitest';
import { storeNamesDisagree } from './storeNameMatch.js';

describe('storeNamesDisagree', () => {
    it('does not disagree when the extracted name is null (model could not read a store name)', () => {
        expect(storeNamesDisagree('Costco', null)).toBe(false);
    });

    it('does not disagree when the extracted name matches exactly', () => {
        expect(storeNamesDisagree('Costco', 'Costco')).toBe(false);
    });

    it('does not disagree case-insensitively', () => {
        expect(storeNamesDisagree('Costco', 'COSTCO')).toBe(false);
    });

    it('does not disagree when the declared store is a substring of a longer printed name', () => {
        expect(storeNamesDisagree('Costco', 'COSTCO WHOLESALE #123')).toBe(false);
    });

    it('does not disagree when the printed name is a substring of the declared store', () => {
        expect(storeNamesDisagree('Costco Wholesale', 'COSTCO')).toBe(false);
    });

    it('disagrees when the printed name names a different store entirely', () => {
        expect(storeNamesDisagree('Costco', 'TARGET T-1234')).toBe(true);
    });

    it('tolerates surrounding whitespace', () => {
        expect(storeNamesDisagree('Costco', '  Costco  ')).toBe(false);
    });
});
