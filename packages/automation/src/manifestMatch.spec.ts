import { describe, it, expect } from 'vitest';
import type { ManifestEntry } from '@mint-csv-converter/receipts';
import { matchManifestEntry } from './manifestMatch.js';

function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    receiptId: 1,
    store: 'Costco',
    payer: 'Brian',
    cardAmount: 150.0,
    purchaseDate: '2026-06-20',
    percentages: { Brian: 62, Patrice: 38 },
    ...overrides,
  };
}

const ROW = ['Costco Wholesale 06/20/2026', 'Brian', '150.00', 'Variably', '%', '%'];

describe('matchManifestEntry', () => {
  it('matches on store, payer, and amount', () => {
    expect(matchManifestEntry(ROW, 'Brian', [entry()])).toEqual({ Brian: 62, Patrice: 38 });
  });

  it('tolerates a cent of float rounding slop', () => {
    expect(matchManifestEntry(ROW, 'Brian', [entry({ cardAmount: 150.005 })])).toEqual({ Brian: 62, Patrice: 38 });
  });

  it('returns null when no entry matches the payer', () => {
    expect(matchManifestEntry(ROW, 'Brian', [entry({ payer: 'Patrice' })])).toBeNull();
  });

  it('returns null when no entry matches the store', () => {
    expect(matchManifestEntry(ROW, 'Brian', [entry({ store: 'Target' })])).toBeNull();
  });

  it('returns null when the amount is outside tolerance', () => {
    expect(matchManifestEntry(ROW, 'Brian', [entry({ cardAmount: 151.0 })])).toBeNull();
  });

  it('returns null with an empty manifest', () => {
    expect(matchManifestEntry(ROW, 'Brian', [])).toBeNull();
  });

  it('tiebreaks multiple same-amount candidates by closest purchaseDate', () => {
    const near = entry({ receiptId: 1, purchaseDate: '2026-06-19', percentages: { Brian: 10, Patrice: 90 } });
    const far = entry({ receiptId: 2, purchaseDate: '2026-05-01', percentages: { Brian: 99, Patrice: 1 } });
    expect(matchManifestEntry(ROW, 'Brian', [far, near])).toEqual({ Brian: 10, Patrice: 90 });
  });
});
