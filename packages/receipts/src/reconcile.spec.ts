import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile.js';
import type { ExtractedReceipt } from './types.js';

function makeReceipt(overrides: Partial<ExtractedReceipt> = {}): ExtractedReceipt {
  return {
    store: 'Costco',
    purchaseDate: '2026-07-24',
    subtotal: 20.0,
    tax: 1.0,
    total: 21.0,
    items: [
      { itemCode: '1', rawName: 'A', quantity: 1, unitPrice: 12.0, lineTotal: 12.0, taxable: false, discountAmount: 0 },
      { itemCode: '2', rawName: 'B', quantity: 1, unitPrice: 8.0, lineTotal: 8.0, taxable: false, discountAmount: 0 },
    ],
    tenders: [],
    ...overrides,
  };
}

describe('reconcile', () => {
  it('reconciles a consistent receipt', () => {
    const result = reconcile(makeReceipt());
    expect(result.reconciled).toBe(true);
    expect(result.lineSum).toBeCloseTo(20.0);
    expect(result.subtotalDelta).toBeCloseTo(0);
    expect(result.totalDelta).toBeCloseTo(0);
  });

  it('subtracts discounts from the line sum', () => {
    const result = reconcile(
      makeReceipt({
        subtotal: 18.0,
        total: 19.0,
        items: [
          { itemCode: '1', rawName: 'A', quantity: 1, unitPrice: 12.0, lineTotal: 12.0, taxable: false, discountAmount: 2.0 },
          { itemCode: '2', rawName: 'B', quantity: 1, unitPrice: 8.0, lineTotal: 8.0, taxable: false, discountAmount: 0 },
        ],
      }),
    );
    expect(result.lineSum).toBeCloseTo(18.0);
    expect(result.reconciled).toBe(true);
  });

  it('flags a receipt whose lines do not sum to the subtotal', () => {
    const result = reconcile(makeReceipt({ subtotal: 25.0, total: 26.0 }));
    expect(result.reconciled).toBe(false);
    expect(result.subtotalDelta).toBeCloseTo(-5.0);
  });

  it('flags a receipt whose subtotal + tax does not equal the total', () => {
    const result = reconcile(makeReceipt({ total: 99.0 }));
    expect(result.reconciled).toBe(false);
    expect(result.totalDelta).toBeCloseTo(-78.0);
  });

  it('allows small rounding differences within tolerance', () => {
    const result = reconcile(makeReceipt({ subtotal: 20.01, total: 21.01 }));
    expect(result.reconciled).toBe(true);
  });

  it('leaves tenderDelta null and reconciles when no tenders were extracted', () => {
    const result = reconcile(makeReceipt());
    expect(result.tenderDelta).toBeNull();
    expect(result.reconciled).toBe(true);
  });

  it('reconciles when a single card tender equals total', () => {
    const result = reconcile(makeReceipt({ tenders: [{ kind: 'CARD', label: 'Card', amount: 21.0 }] }));
    expect(result.tenderDelta).toBeCloseTo(0);
    expect(result.reconciled).toBe(true);
  });

  it('reconciles a purchase split across card and cash tenders', () => {
    const result = reconcile(
      makeReceipt({
        tenders: [
          { kind: 'CARD', label: 'Card', amount: 15.0 },
          { kind: 'CASH', label: 'Cash', amount: 6.0 },
        ],
      }),
    );
    expect(result.tenderDelta).toBeCloseTo(0);
    expect(result.reconciled).toBe(true);
  });

  it('flags a receipt whose tenders do not sum to total', () => {
    const result = reconcile(makeReceipt({ tenders: [{ kind: 'CARD', label: 'Card', amount: 10.0 }] }));
    expect(result.tenderDelta).toBeCloseTo(-11.0);
    expect(result.reconciled).toBe(false);
  });
});
