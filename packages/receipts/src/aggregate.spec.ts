import { describe, it, expect } from 'vitest';
import { aggregateSplits, evenPercentages, type AggregateLine } from './aggregate.js';

const PARTICIPANTS = ['Brian', 'Patrice'];

describe('aggregateSplits', () => {
  it('returns an even split when every line is 50/50', () => {
    const lines: AggregateLine[] = [
      { lineTotal: 10, splits: { Brian: 50, Patrice: 50 } },
      { lineTotal: 30, splits: { Brian: 50, Patrice: 50 } },
    ];
    expect(aggregateSplits(lines, PARTICIPANTS)).toEqual({ Brian: 50, Patrice: 50 });
  });

  it('weights by line value, not line count', () => {
    // Brian owns a $90 item fully; Patrice owns a $10 item fully.
    const lines: AggregateLine[] = [
      { lineTotal: 90, splits: { Brian: 100, Patrice: 0 } },
      { lineTotal: 10, splits: { Brian: 0, Patrice: 100 } },
    ];
    expect(aggregateSplits(lines, PARTICIPANTS)).toEqual({ Brian: 90, Patrice: 10 });
  });

  it('subtracts discounts from a line’s net value', () => {
    const lines: AggregateLine[] = [
      { lineTotal: 100, discountAmount: 20, splits: { Brian: 100, Patrice: 0 } },
      { lineTotal: 20, splits: { Brian: 0, Patrice: 100 } },
    ];
    // Brian net 80, Patrice net 20 → 80/20.
    expect(aggregateSplits(lines, PARTICIPANTS)).toEqual({ Brian: 80, Patrice: 20 });
  });

  it('rounds so percentages always sum to 100 (largest remainder)', () => {
    // Brian owns a $1 item, Patrice a $2 item → 33.33 / 66.67 → 33 / 67.
    const lines: AggregateLine[] = [
      { lineTotal: 1, splits: { Brian: 100, Patrice: 0 } },
      { lineTotal: 2, splits: { Brian: 0, Patrice: 100 } },
    ];
    const result = aggregateSplits(lines, PARTICIPANTS);
    expect(result.Brian + result.Patrice).toBe(100);
    expect(result).toEqual({ Brian: 33, Patrice: 67 });
  });

  it('handles a zero-total receipt without dividing by zero', () => {
    const lines: AggregateLine[] = [{ lineTotal: 0, splits: { Brian: 50, Patrice: 50 } }];
    expect(aggregateSplits(lines, PARTICIPANTS)).toEqual({ Brian: 0, Patrice: 0 });
  });
});

describe('evenPercentages', () => {
  it('splits evenly with no remainder', () => {
    expect(evenPercentages(2)).toEqual([50, 50]);
    expect(evenPercentages(4)).toEqual([25, 25, 25, 25]);
  });

  it('distributes the remainder to the earliest entries', () => {
    expect(evenPercentages(3)).toEqual([34, 33, 33]);
  });

  it('sums to 100 for any count', () => {
    for (const count of [1, 2, 3, 5, 7]) {
      expect(evenPercentages(count).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it('returns an empty array for zero participants', () => {
    expect(evenPercentages(0)).toEqual([]);
  });
});
