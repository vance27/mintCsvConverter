import { describe, it, expect } from 'vitest';
import { toIsoDate, getPeriodLabel } from './dateUtils.js';

describe('toIsoDate', () => {
    it('converts MM/DD/YYYY to YYYY-MM-DD', () => {
        expect(toIsoDate('06/29/2026')).toBe('2026-06-29');
    });

    it('throws on an unrecognized format', () => {
        expect(() => toIsoDate('2026-06-29')).toThrow(/Unrecognized date format/);
    });
});

describe('getPeriodLabel', () => {
    it('converts MM/DD/YYYY to MM/YY', () => {
        expect(getPeriodLabel('06/29/2026')).toBe('06/26');
    });

    it('throws on an unrecognized format', () => {
        expect(() => getPeriodLabel('not-a-date')).toThrow(/Unrecognized date format/);
    });
});
