import { describe, it, expect } from 'vitest';
import { cardAmount } from './tender.js';

describe('cardAmount', () => {
  it('falls back to the full total when no tenders were extracted', () => {
    expect(cardAmount([], 82.15)).toBe(82.15);
  });

  it('returns the card tender amount when the whole receipt was paid by card', () => {
    expect(cardAmount([{ kind: 'CARD', label: 'Card', amount: 82.15 }], 82.15)).toBe(82.15);
  });

  it('returns only the card portion when split across card and cash', () => {
    const tenders = [
      { kind: 'CARD' as const, label: 'Card', amount: 32.15 },
      { kind: 'CASH' as const, label: 'Cash', amount: 20.0 },
      { kind: 'COSTCO_CASH_REWARD' as const, label: 'Costco Cash Reward', amount: 30.0 },
    ];
    expect(cardAmount(tenders, 82.15)).toBeCloseTo(32.15);
  });

  it('sums multiple card tenders', () => {
    const tenders = [
      { kind: 'CARD' as const, label: 'Card', amount: 20.0 },
      { kind: 'CARD' as const, label: 'Card', amount: 15.0 },
    ];
    expect(cardAmount(tenders, 35.0)).toBeCloseTo(35.0);
  });

  it('returns 0 when the receipt was paid entirely by non-card tender', () => {
    expect(cardAmount([{ kind: 'CASH', label: 'Cash', amount: 10.0 }], 10.0)).toBe(0);
  });
});
