import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { extractReceipt, buildExtractionPrompt } from './extractReceipt.js';
import type { VisionChatClient } from './ollamaClient.js';

const FIXTURE = fileURLToPath(new URL('./testing/fixtures/blank-page.pdf', import.meta.url));

function fakeClient(content: string): VisionChatClient & { chat: ReturnType<typeof vi.fn> } {
  return { chat: vi.fn(async () => ({ message: { content } })) };
}

const VALID_RECEIPT_JSON = JSON.stringify({
  store: 'Costco',
  purchaseDate: '2026-07-25',
  subtotal: 233.58,
  tax: 3.34,
  total: 236.92,
  items: [
    { itemCode: '1374492', rawName: 'WELCH SNACKS', quantity: 1, unitPrice: 13.89, lineTotal: 13.89, taxable: true, discountAmount: 0 },
    { itemCode: '57554', rawName: 'BLUEBERRIES', quantity: 3, unitPrice: 3.99, lineTotal: 11.97, taxable: false, discountAmount: 0 },
  ],
});

describe('extractReceipt', () => {
  it('parses and validates a well-formed model response', async () => {
    const client = fakeClient(VALID_RECEIPT_JSON);
    const receipt = await extractReceipt(FIXTURE, client, { store: 'Costco' });

    expect(receipt.total).toBe(236.92);
    expect(receipt.items).toHaveLength(2);
    expect(receipt.items[1]).toMatchObject({ rawName: 'BLUEBERRIES', quantity: 3, unitPrice: 3.99, lineTotal: 11.97 });
  });

  it('sends rendered page images and the Costco-tuned prompt to the model', async () => {
    const client = fakeClient(VALID_RECEIPT_JSON);
    await extractReceipt(FIXTURE, client, { store: 'Costco' });

    expect(client.chat).toHaveBeenCalledTimes(1);
    const request = client.chat.mock.calls[0][0] as { messages: { images?: string[]; content: string }[] };
    expect(request.messages[0].images).toHaveLength(1);
    expect(request.messages[0].content).toContain('Costco');
  });

  it('fills in defaults for optional fields (itemCode, discountAmount, quantity)', async () => {
    const client = fakeClient(
      JSON.stringify({
        purchaseDate: '2026-07-25',
        subtotal: 10,
        tax: 0,
        total: 10,
        items: [{ rawName: 'MYSTERY ITEM', unitPrice: 10, lineTotal: 10 }],
      }),
    );
    const receipt = await extractReceipt(FIXTURE, client);
    expect(receipt.items[0]).toMatchObject({ itemCode: null, quantity: 1, discountAmount: 0, taxable: null });
  });

  it('throws a clear error when the model returns non-JSON', async () => {
    const client = fakeClient('not json at all');
    await expect(extractReceipt(FIXTURE, client)).rejects.toThrow(/did not return valid JSON/);
  });

  it('throws a clear error when required fields are missing', async () => {
    const client = fakeClient(JSON.stringify({ items: [] }));
    await expect(extractReceipt(FIXTURE, client)).rejects.toThrow(/failed validation/);
  });

  it('defaults tenders to an empty array when the model omits them', async () => {
    const client = fakeClient(VALID_RECEIPT_JSON);
    const receipt = await extractReceipt(FIXTURE, client, { store: 'Costco' });
    expect(receipt.tenders).toEqual([]);
  });

  it('parses a split card/cash tender breakdown', async () => {
    const client = fakeClient(
      JSON.stringify({
        ...JSON.parse(VALID_RECEIPT_JSON),
        tenders: [
          { kind: 'CARD', label: 'Card', amount: 200.92 },
          { kind: 'CASH', label: 'Cash', amount: 36.0 },
        ],
      }),
    );
    const receipt = await extractReceipt(FIXTURE, client, { store: 'Costco' });
    expect(receipt.tenders).toEqual([
      { kind: 'CARD', label: 'Card', amount: 200.92 },
      { kind: 'CASH', label: 'Cash', amount: 36.0 },
    ]);
  });

  it('rejects a tender with an unrecognized kind', async () => {
    const client = fakeClient(
      JSON.stringify({
        ...JSON.parse(VALID_RECEIPT_JSON),
        tenders: [{ kind: 'BITCOIN', label: 'Crypto', amount: 236.92 }],
      }),
    );
    await expect(extractReceipt(FIXTURE, client)).rejects.toThrow(/failed validation/);
  });
});

describe('buildExtractionPrompt', () => {
  it('uses the Costco-tuned prompt for Costco', () => {
    expect(buildExtractionPrompt('Costco')).toContain('Costco warehouse receipt');
  });

  it('is case-insensitive on store name', () => {
    expect(buildExtractionPrompt('costco')).toContain('Costco warehouse receipt');
  });

  it('falls back to a generic prompt for other stores', () => {
    expect(buildExtractionPrompt('Target')).not.toContain('Costco warehouse receipt');
    expect(buildExtractionPrompt(undefined)).not.toContain('Costco warehouse receipt');
  });

  it('includes a worked example of the /-referenced discount-line format', () => {
    expect(buildExtractionPrompt('Costco')).toContain('/1774692');
    expect(buildExtractionPrompt('Costco')).toMatch(/discountAmount 14\.00/);
  });
});
