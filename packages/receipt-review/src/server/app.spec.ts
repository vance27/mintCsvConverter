import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import { seedParticipants, type PrismaClient, type VisionChatClient } from '@mint-csv-converter/receipts';
import { createApp } from './app.js';
import { seedBasicReceipt } from './testing/fixtures.js';

function fakeClient(content: unknown): VisionChatClient {
  return { chat: vi.fn(async () => ({ message: { content: JSON.stringify(content) } })) };
}

/** A minimal, valid, distinct-content PDF — same fixture style as packages/receipts' own specs. */
function writeFixturePdf(dir: string, name: string, width = 200): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} 200]/Resources<<>>>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n`,
  );
  return path;
}

describe('app', () => {
  let prisma: PrismaClient;
  let cleanup: () => void;
  let dir: string;

  afterEach(() => {
    cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    ({ prisma, cleanup } = createTestDb());
    dir = mkdtempSync(join(tmpdir(), 'app-test-'));
    const app = createApp({
      prisma,
      client: fakeClient({}),
      receiptsBaseDir: join(dir, 'retained'),
      submitOptions: { manifestPath: join(dir, 'manifest.json'), auditDir: join(dir, 'audits') },
    });
    return { app };
  }

  it('responds to a health check', async () => {
    const { app } = setup();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('lists receipts needing review', async () => {
    const { app } = setup();
    const seeded = await seedBasicReceipt(prisma);

    const res = await app.request('/api/receipts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number }[];
    expect(body.map((r) => r.id)).toEqual([seeded.receiptId]);
  });

  it('404s for a nonexistent receipt, 200s with detail for a real one', async () => {
    const { app } = setup();
    const seeded = await seedBasicReceipt(prisma);

    expect((await app.request('/api/receipts/999999')).status).toBe(404);

    const res = await app.request(`/api/receipts/${seeded.receiptId}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { lineItems: unknown[] };
    expect(detail.lineItems).toHaveLength(2);
  });

  it('rejects splits that do not sum to 100, accepts valid ones', async () => {
    const { app } = setup();
    const seeded = await seedBasicReceipt(prisma);

    const bad = await app.request(`/api/receipts/${seeded.receiptId}/line-items/${seeded.lineItemIds[0]}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ splits: { Brian: 70, Patrice: 20 } }),
    });
    expect(bad.status).toBe(400);

    const good = await app.request(`/api/receipts/${seeded.receiptId}/line-items/${seeded.lineItemIds[0]}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ splits: { Brian: 70, Patrice: 30 } }),
    });
    expect(good.status).toBe(200);
  });

  it('rejects submit until every line is reviewed, then succeeds', async () => {
    const { app } = setup();
    const seeded = await seedBasicReceipt(prisma);

    const early = await app.request(`/api/receipts/${seeded.receiptId}/submit`, { method: 'POST' });
    expect(early.status).toBe(400);

    for (const lineItemId of seeded.lineItemIds) {
      const res = await app.request(`/api/receipts/${seeded.receiptId}/line-items/${lineItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ splits: { Brian: 50, Patrice: 50 } }),
      });
      expect(res.status).toBe(200);
    }

    const submitted = await app.request(`/api/receipts/${seeded.receiptId}/submit`, { method: 'POST' });
    expect(submitted.status).toBe(200);
    const body = (await submitted.json()) as { aggregate: Record<string, number> };
    expect(body.aggregate).toEqual({ Brian: 50, Patrice: 50 });
  });

  it('serves the retained source PDF', async () => {
    const { app } = setup();
    const pdfPath = writeFixturePdf(dir, 'source.pdf');
    // Point the seeded receipt at a real file on disk so the route can read it.
    const seeded = await seedBasicReceipt(prisma);
    await prisma.receipt.update({ where: { id: seeded.receiptId }, data: { sourcePath: pdfPath } });

    const res = await app.request(`/api/receipts/${seeded.receiptId}/source.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await res.text()).toContain('%PDF-1.4');
  });

  it('uploads a receipt and reports job completion via polling', async () => {
    const receiptJson = {
      store: 'Costco',
      purchaseDate: '2026-07-24',
      subtotal: 10,
      tax: 0,
      total: 10,
      items: [{ itemCode: '999', rawName: 'TEST ITEM', quantity: 1, unitPrice: 10, lineTotal: 10, taxable: false, discountAmount: 0 }],
    };
    ({ prisma, cleanup } = createTestDb());
    dir = mkdtempSync(join(tmpdir(), 'app-test-'));
    await seedParticipants(prisma, ['Brian', 'Patrice']);
    const app = createApp({ prisma, client: fakeClient(receiptJson), receiptsBaseDir: join(dir, 'retained') });

    const pdfPath = writeFixturePdf(dir, 'upload.pdf');
    const formData = new FormData();
    formData.append('files', new Blob([readFileSync(pdfPath)]), 'upload.pdf');
    formData.append('store', 'Costco');
    formData.append('payer', 'Brian');

    const uploadRes = await app.request('/api/uploads', { method: 'POST', body: formData });
    expect(uploadRes.status).toBe(200);
    const { jobIds } = (await uploadRes.json()) as { jobIds: string[] };
    expect(jobIds).toHaveLength(1);

    let job: { status: string; result?: { receiptId: number } } | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      const res = await app.request(`/api/uploads/${jobIds[0]}`);
      job = (await res.json()) as typeof job;
      if (job?.status !== 'pending') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(job?.status).toBe('done');
    expect(job?.result?.receiptId).toBeGreaterThan(0);
  });
});
