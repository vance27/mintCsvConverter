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

  it('imports a CSV export, staging transactions without touching Sheets', async () => {
    const { app } = setup();
    const csv = [
      'Status,Date,Description,Debit,Credit,Member Name',
      'Cleared,06/20/2026,Chipotle Mexican Grill,25.00,,BRIAN K VANCE',
      'Cleared,06/21/2026,Costco Wholesale,150.00,,BRIAN K VANCE',
      'Cleared,06/22/2026,CITI CARD PAYMENT,500.00,,BRIAN K VANCE',
    ].join('\n');
    const formData = new FormData();
    formData.append('files', new Blob([csv]), 'export.csv');
    formData.append('payer', 'Brian');

    const importRes = await app.request('/api/imports', { method: 'POST', body: formData });
    expect(importRes.status).toBe(200);
    const { jobIds } = (await importRes.json()) as { jobIds: string[] };
    expect(jobIds).toHaveLength(1);

    let job: { status: string; result?: { importedCount: number; skippedDuplicateCount: number; excludedCount: number } } | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      const res = await app.request(`/api/imports/${jobIds[0]}`);
      job = (await res.json()) as typeof job;
      if (job?.status !== 'pending') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(job?.status).toBe('done');
    expect(job?.result).toEqual({ importedCount: 3, skippedDuplicateCount: 0, excludedCount: 1 });

    const staged = await prisma.importedTransaction.findMany({ orderBy: { date: 'asc' } });
    expect(staged.map((t) => ({ description: t.description, splitType: t.splitType, excluded: t.excluded }))).toEqual([
      { description: 'Chipotle Mexican Grill', splitType: 'Equally', excluded: false },
      { description: 'Costco Wholesale', splitType: 'Variably', excluded: false },
      { description: 'CITI CARD PAYMENT', splitType: 'Equally', excluded: true },
    ]);
  });

  it('re-importing an overlapping export skips already-staged transactions', async () => {
    const { app } = setup();
    const csv = ['Status,Date,Description,Debit,Credit,Member Name', 'Cleared,06/20/2026,Chipotle Mexican Grill,25.00,,BRIAN K VANCE'].join(
      '\n',
    );

    async function importOnce(): Promise<{ importedCount: number; skippedDuplicateCount: number; excludedCount: number }> {
      const formData = new FormData();
      formData.append('files', new Blob([csv]), 'export.csv');
      formData.append('payer', 'Brian');
      const res = await app.request('/api/imports', { method: 'POST', body: formData });
      const { jobIds } = (await res.json()) as { jobIds: string[] };

      let job: { status: string; result?: { importedCount: number; skippedDuplicateCount: number; excludedCount: number } } | undefined;
      for (let attempt = 0; attempt < 50; attempt++) {
        const jobRes = await app.request(`/api/imports/${jobIds[0]}`);
        job = (await jobRes.json()) as typeof job;
        if (job?.status !== 'pending') {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!job?.result) {
        throw new Error(`Import job did not complete: ${JSON.stringify(job)}`);
      }
      return job.result;
    }

    const first = await importOnce();
    expect(first).toEqual({ importedCount: 1, skippedDuplicateCount: 0, excludedCount: 0 });

    const second = await importOnce();
    expect(second).toEqual({ importedCount: 0, skippedDuplicateCount: 1, excludedCount: 0 });

    expect(await prisma.importedTransaction.count()).toBe(1);
  });

  it('matches a Variably transaction to its receipt, submitted or not, and leaves Equally/unmatched ones alone', async () => {
    const { app } = setup();
    const seeded = await seedBasicReceipt(prisma); // Costco, Brian, cardAmount 20, purchaseDate 2026-07-01, EXTRACTED

    await prisma.importedTransaction.createMany({
      data: [
        { payer: 'Brian', date: '07/01/2026', description: 'Costco Wholesale', amount: 20, splitType: 'Variably' },
        { payer: 'Brian', date: '07/02/2026', description: 'Target', amount: 99, splitType: 'Variably' },
        { payer: 'Brian', date: '07/03/2026', description: 'Chipotle', amount: 25, splitType: 'Equally' },
      ],
    });

    const res = await app.request('/api/transactions');
    expect(res.status).toBe(200);
    const transactions = (await res.json()) as {
      description: string;
      splitType: string;
      receiptMatch: { receiptId: number; status: string; aggregate: Record<string, number> } | null;
    }[];

    expect(transactions.find((t) => t.description === 'Costco Wholesale')?.receiptMatch).toEqual({
      receiptId: seeded.receiptId,
      status: 'EXTRACTED',
      aggregate: { Brian: 50, Patrice: 50 },
    });
    expect(transactions.find((t) => t.description === 'Target')?.receiptMatch).toBeNull();
    expect(transactions.find((t) => t.description === 'Chipotle')?.receiptMatch).toBeNull();

    await prisma.receipt.update({ where: { id: seeded.receiptId }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    const afterSubmit = (await (await app.request('/api/transactions')).json()) as typeof transactions;
    expect(afterSubmit.find((t) => t.description === 'Costco Wholesale')?.receiptMatch?.status).toBe('SUBMITTED');
  });
});
