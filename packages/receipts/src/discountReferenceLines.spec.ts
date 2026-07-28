import { describe, it, expect } from 'vitest';
import { foldDiscountReferenceLines } from './discountReferenceLines.js';
import type { ExtractedLineItem } from './types.js';

function item(overrides: Partial<ExtractedLineItem>): ExtractedLineItem {
  return {
    itemCode: null,
    rawName: 'ITEM',
    quantity: 1,
    unitPrice: 1,
    lineTotal: 1,
    taxable: null,
    discountAmount: 0,
    ...overrides,
  };
}

describe('foldDiscountReferenceLines', () => {
  it('folds a clean "/itemCode" reference line into the item it references, and drops the reference line', () => {
    const items = [
      item({ itemCode: '2848101', rawName: 'CASCSHN BOOST', lineTotal: 17.99 }),
      item({ itemCode: '35512', rawName: '/2848101', lineTotal: 4.0 }),
    ];

    const result = foldDiscountReferenceLines(items);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ itemCode: '2848101', rawName: 'CASCSHN BOOST', lineTotal: 17.99, discountAmount: 4.0 });
  });

  it('folds every reference line on a real multi-discount Costco receipt — regression lock for a live extraction failure', () => {
    // Reproduces the exact pattern found in a real ingest: the model
    // correctly read each discount line's own printed code and the "/"
    // prefixed reference, but emitted it as its own item instead of
    // folding it into discountAmount — for every discount line on the
    // receipt except the one the prompt's worked example demonstrated.
    const items = [
      item({ itemCode: '2848101', rawName: 'CASCSHN BOOST', lineTotal: 17.99 }),
      item({ itemCode: '35512', rawName: '/2848101', lineTotal: 4.0 }),
      item({ itemCode: '670441', rawName: "PEET'S BLEND", lineTotal: 21.49 }),
      item({ itemCode: '379135', rawName: '/670441', lineTotal: 6.5 }),
      item({ itemCode: '933402', rawName: 'DORITOS 3OZ', lineTotal: 6.99 }),
      item({ itemCode: '380813', rawName: '/933402', lineTotal: 2.0 }),
      item({ itemCode: '1502205', rawName: 'ORGAIN CHOCO', lineTotal: 33.99 }),
      item({ itemCode: '382178', rawName: '/1502205', lineTotal: 8.0 }),
    ];

    const result = foldDiscountReferenceLines(items);

    expect(result.map((i) => i.itemCode)).toEqual(['2848101', '670441', '933402', '1502205']);
    expect(result.map((i) => i.discountAmount)).toEqual([4.0, 6.5, 2.0, 8.0]);
  });

  it('leaves a reference line alone when its target cannot be confidently found (e.g. the referenced code was itself misread)', () => {
    const items = [
      item({ itemCode: '264527ABRE', rawName: 'KOMB', lineTotal: 11.99 }),
      item({ itemCode: '379154', rawName: '/2022527', lineTotal: 4.0 }),
    ];

    const result = foldDiscountReferenceLines(items);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ itemCode: '379154', rawName: '/2022527', discountAmount: 0 });
  });

  it('accumulates two discount lines that both reference the same item', () => {
    const items = [
      item({ itemCode: '1774692', rawName: 'WEED&FEED', lineTotal: 74.99 }),
      item({ itemCode: '380381', rawName: '/1774692', lineTotal: 14.0 }),
      item({ itemCode: '111111', rawName: '/1774692', lineTotal: 5.0 }),
    ];

    const result = foldDiscountReferenceLines(items);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ itemCode: '1774692', discountAmount: 19.0 });
  });

  it('leaves ordinary items with no reference-line pattern untouched', () => {
    const items = [item({ itemCode: '123', rawName: 'WELCH SNACKS', lineTotal: 13.89 })];

    expect(foldDiscountReferenceLines(items)).toEqual(items);
  });
});
