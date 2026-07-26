import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { extractReconciledReceipt } from './extractReconciled.js';
import type { VisionChatClient } from './ollamaClient.js';

const FIXTURE = fileURLToPath(new URL('./testing/fixtures/blank-page.pdf', import.meta.url));

const RECONCILED_JSON = JSON.stringify({
  purchaseDate: '2026-07-25',
  subtotal: 10,
  tax: 0,
  total: 10,
  items: [{ rawName: 'A', unitPrice: 10, lineTotal: 10 }],
});

const UNRECONCILED_JSON = JSON.stringify({
  purchaseDate: '2026-07-25',
  subtotal: 10,
  tax: 0,
  total: 999,
  items: [{ rawName: 'A', unitPrice: 10, lineTotal: 10 }],
});

function fakeClientReturning(...responses: string[]): VisionChatClient & { chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn();
  for (const content of responses) {
    chat.mockImplementationOnce(async () => ({ message: { content } }));
  }
  return { chat };
}

describe('extractReconciledReceipt', () => {
  it('returns after one attempt when the first extraction reconciles', async () => {
    const client = fakeClientReturning(RECONCILED_JSON);
    const result = await extractReconciledReceipt(FIXTURE, client);

    expect(result.attempts).toBe(1);
    expect(result.reconcile.reconciled).toBe(true);
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  it('retries after an unreconciled attempt and returns the reconciled retry', async () => {
    const client = fakeClientReturning(UNRECONCILED_JSON, RECONCILED_JSON);
    const result = await extractReconciledReceipt(FIXTURE, client);

    expect(result.attempts).toBe(2);
    expect(result.reconcile.reconciled).toBe(true);
    expect(result.receipt.total).toBe(10);
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts and returns the last attempt still flagged unreconciled', async () => {
    const client = fakeClientReturning(UNRECONCILED_JSON, UNRECONCILED_JSON, UNRECONCILED_JSON);
    const result = await extractReconciledReceipt(FIXTURE, client, {}, 3);

    expect(result.attempts).toBe(3);
    expect(result.reconcile.reconciled).toBe(false);
    expect(client.chat).toHaveBeenCalledTimes(3);
  });

  it('respects a custom maxAttempts', async () => {
    const client = fakeClientReturning(UNRECONCILED_JSON, UNRECONCILED_JSON);
    const result = await extractReconciledReceipt(FIXTURE, client, {}, 1);

    expect(result.attempts).toBe(1);
    expect(result.reconcile.reconciled).toBe(false);
    expect(client.chat).toHaveBeenCalledTimes(1);
  });
});
