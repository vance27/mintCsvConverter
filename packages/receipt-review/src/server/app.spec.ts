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

/** The seed migration's default Citi profile — present in every freshly-migrated test DB. */
async function citiProfileId(prisma: PrismaClient): Promise<number> {
  return (await prisma.csvImportProfile.findFirstOrThrow({ where: { name: 'Citi (default)' } })).id;
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

  function setup(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
    ({ prisma, cleanup } = createTestDb());
    dir = mkdtempSync(join(tmpdir(), 'app-test-'));
    const app = createApp({
      prisma,
      client: fakeClient({}),
      receiptsBaseDir: join(dir, 'retained'),
      submitOptions: { auditDir: join(dir, 'audits') },
      ...overrides,
    });
    return { app };
  }

  it('responds to a health check', async () => {
    const { app } = setup();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('reports the configured SPREADSHEET_ID, or null when unset, for the Sheet embed', async () => {
    const { app } = setup();
    const originalValue = process.env.SPREADSHEET_ID;
    try {
      delete process.env.SPREADSHEET_ID;
      const unsetRes = await app.request('/api/config');
      expect(await unsetRes.json()).toEqual({ spreadsheetId: null });

      // Also treated as unset — the e2e suite blanks this rather than
      // deleting it, to override whatever Nx's automatic .env loading put there.
      process.env.SPREADSHEET_ID = '';
      const blankRes = await app.request('/api/config');
      expect(await blankRes.json()).toEqual({ spreadsheetId: null });

      process.env.SPREADSHEET_ID = 'test-spreadsheet-id';
      const setRes = await app.request('/api/config');
      expect(await setRes.json()).toEqual({ spreadsheetId: 'test-spreadsheet-id' });
    } finally {
      if (originalValue === undefined) {
        delete process.env.SPREADSHEET_ID;
      } else {
        process.env.SPREADSHEET_ID = originalValue;
      }
    }
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
    formData.append('profileId', String(await citiProfileId(prisma)));

    const importRes = await app.request('/api/imports', { method: 'POST', body: formData });
    expect(importRes.status).toBe(200);
    const { jobIds } = (await importRes.json()) as { jobIds: string[] };
    expect(jobIds).toHaveLength(1);

    let job:
      | { status: string; result?: { importedCount: number; skippedDuplicateCount: number; excludedCount: number; importBatchId: number | null } }
      | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      const res = await app.request(`/api/imports/${jobIds[0]}`);
      job = (await res.json()) as typeof job;
      if (job?.status !== 'pending') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(job?.status).toBe('done');
    expect(job?.result?.importedCount).toBe(3);
    expect(job?.result?.skippedDuplicateCount).toBe(0);
    expect(job?.result?.excludedCount).toBe(1);
    expect(typeof job?.result?.importBatchId).toBe('number');
    const importBatchId = job?.result?.importBatchId as number;

    const staged = await prisma.importedTransaction.findMany({ orderBy: { date: 'asc' } });
    expect(staged.map((t) => ({ description: t.description, splitType: t.splitType, excluded: t.excluded }))).toEqual([
      { description: 'Chipotle Mexican Grill', splitType: 'Equally', excluded: false },
      { description: 'Costco Wholesale', splitType: 'Variably', excluded: false },
      { description: 'CITI CARD PAYMENT', splitType: 'Equally', excluded: true },
    ]);
    expect(staged.every((t) => t.importBatchId === importBatchId)).toBe(true);

    interface ImportBatchJson {
      id: number;
      title: string;
      description: string | null;
      payer: string;
      minDate: string;
      maxDate: string;
      sourceFilename: string;
      csvImportProfileId: number | null;
      createdAt: string;
      importedCount: number;
      skippedDuplicateCount: number;
      excludedCount: number;
    }

    const batches = (await (await app.request('/api/import-batches')).json()) as ImportBatchJson[];
    expect(batches).toHaveLength(1);
    expect(batches[0].title).toContain('Brian');
    expect(batches[0]).toMatchObject({
      id: importBatchId,
      description: null,
      payer: 'Brian',
      minDate: '06/20/2026',
      maxDate: '06/22/2026',
      sourceFilename: 'export.csv',
      csvImportProfileId: await citiProfileId(prisma),
      importedCount: 3,
      skippedDuplicateCount: 0,
      excludedCount: 1,
    });

    const renamed = await app.request(`/api/import-batches/${batches[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'June Citi export', description: 'Remember to pull the July return credit next time' }),
    });
    expect(renamed.status).toBe(200);
    const renamedBody = (await renamed.json()) as ImportBatchJson;
    expect(renamedBody).toEqual({ ...batches[0], title: 'June Citi export', description: 'Remember to pull the July return credit next time' });
  });

  it('previews a Citi-shaped CSV and auto-detects the seeded default profile', async () => {
    const { app } = setup();
    const csv = ['Status,Date,Description,Debit,Credit,Member Name', 'Cleared,06/20/2026,Chipotle Mexican Grill,25.00,,BRIAN K VANCE'].join('\n');
    const formData = new FormData();
    formData.append('file', new Blob([csv]), 'export.csv');

    const res = await app.request('/api/csv-import-preview', { method: 'POST', body: formData });
    expect(res.status).toBe(200);
    const preview = (await res.json()) as { columnCount: number; detectedProfile: { name: string } | null };
    expect(preview.columnCount).toBe(6);
    expect(preview.detectedProfile?.name).toBe('Citi (default)');
  });

  it('previews a never-before-seen CSV shape and finds no matching profile', async () => {
    const { app } = setup();
    const csv = ['Date,Description,Amount', '06/20/2026,Chipotle,-25.00'].join('\n');
    const formData = new FormData();
    formData.append('file', new Blob([csv]), 'export.csv');

    const res = await app.request('/api/csv-import-preview', { method: 'POST', body: formData });
    expect(res.status).toBe(200);
    const preview = (await res.json()) as { columnCount: number; detectedProfile: unknown };
    expect(preview.columnCount).toBe(3);
    expect(preview.detectedProfile).toBeNull();
  });

  it('CRUDs CSV import profiles and imports a non-Citi CSV shape through a newly-saved one', async () => {
    const { app } = setup();

    const createRes = await app.request('/api/csv-import-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Single Amount column',
        hasHeader: true,
        columnCount: 3,
        headerSignature: 'date,description,amount',
        columnMapping: {
          hasHeader: true,
          dateColumn: { byName: 'date' },
          descriptionColumn: { byName: 'description' },
          amount: { mode: 'SIGNED_AMOUNT', amountColumn: { byName: 'amount' }, flipSign: true },
        },
      }),
    });
    expect(createRes.status).toBe(200);
    const profile = (await createRes.json()) as { id: number; name: string };

    const listRes = await app.request('/api/csv-import-profiles');
    expect((await listRes.json()) as { name: string }[]).toContainEqual(expect.objectContaining({ name: 'Single Amount column' }));

    const csv = ['Date,Description,Amount', '06/20/2026,Refund from Chipotle,25.00', '06/21/2026,Costco run,-150.00'].join('\n');
    const formData = new FormData();
    formData.append('files', new Blob([csv]), 'export.csv');
    formData.append('payer', 'Brian');
    formData.append('profileId', String(profile.id));
    const importRes = await app.request('/api/imports', { method: 'POST', body: formData });
    const { jobIds } = (await importRes.json()) as { jobIds: string[] };

    let job: { status: string } | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      job = (await (await app.request(`/api/imports/${jobIds[0]}`)).json()) as typeof job;
      if (job?.status !== 'pending') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(job?.status).toBe('done');

    const staged = await prisma.importedTransaction.findMany({ orderBy: { date: 'asc' } });
    // flipSign: true negates the raw column value, so a positive "Amount"
    // (refund) becomes negative and a negative one (purchase) becomes positive.
    expect(staged.map((t) => ({ description: t.description, amount: t.amount, splitType: t.splitType }))).toEqual([
      { description: 'Refund from Chipotle', amount: -25, splitType: 'Equally' },
      { description: 'Costco run', amount: 150, splitType: 'Variably' },
    ]);

    const deleteRes = await app.request(`/api/csv-import-profiles/${profile.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
    const afterDelete = (await (await app.request('/api/csv-import-profiles')).json()) as { id: number }[];
    expect(afterDelete.some((p) => p.id === profile.id)).toBe(false);
  });

  it('re-importing an overlapping export skips already-staged transactions', async () => {
    const { app } = setup();
    const csv = ['Status,Date,Description,Debit,Credit,Member Name', 'Cleared,06/20/2026,Chipotle Mexican Grill,25.00,,BRIAN K VANCE'].join(
      '\n',
    );

    async function importOnce(): Promise<{ importedCount: number; skippedDuplicateCount: number; excludedCount: number; importBatchId: number | null }> {
      const formData = new FormData();
      formData.append('files', new Blob([csv]), 'export.csv');
      formData.append('payer', 'Brian');
      formData.append('profileId', String(await citiProfileId(prisma)));
      const res = await app.request('/api/imports', { method: 'POST', body: formData });
      const { jobIds } = (await res.json()) as { jobIds: string[] };

      let job:
        | { status: string; result?: { importedCount: number; skippedDuplicateCount: number; excludedCount: number; importBatchId: number | null } }
        | undefined;
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
    expect(first.importedCount).toBe(1);
    expect(first.skippedDuplicateCount).toBe(0);
    expect(first.excludedCount).toBe(0);
    expect(typeof first.importBatchId).toBe('number');

    const second = await importOnce();
    // Even a fully-duplicate re-import still creates a (data-less-in-effect
    // but still date-ranged) batch, since candidates.length > 0 — only a
    // truly empty/header-only CSV skips batch creation.
    expect(second.importedCount).toBe(0);
    expect(second.skippedDuplicateCount).toBe(1);
    expect(second.excludedCount).toBe(0);
    expect(typeof second.importBatchId).toBe('number');
    expect(second.importBatchId).not.toBe(first.importBatchId);

    expect(await prisma.importedTransaction.count()).toBe(1);
  });

  it('CRUDs payer exclusion rules and has them take effect on the next import', async () => {
    const { app } = setup();

    const listRes = await app.request('/api/exclusion-rules');
    expect(listRes.status).toBe(200);
    const seeded = (await listRes.json()) as { id: number; payer: string; pattern: string }[];
    expect(seeded.some((r) => r.payer === 'BRIAN' && r.pattern === 'CITI CARD')).toBe(true);

    const createRes = await app.request('/api/exclusion-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payer: 'brian', pattern: 'TEST EXCLUSION VENDOR' }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { id: number; payer: string };
    expect(created.payer).toBe('BRIAN'); // stored uppercased regardless of input casing

    const csv = ['Status,Date,Description,Debit,Credit,Member Name', 'Cleared,06/20/2026,TEST EXCLUSION VENDOR PURCHASE,25.00,,BRIAN K VANCE'].join(
      '\n',
    );
    const formData = new FormData();
    formData.append('files', new Blob([csv]), 'export.csv');
    formData.append('payer', 'Brian');
    formData.append('profileId', String(await citiProfileId(prisma)));
    const importRes = await app.request('/api/imports', { method: 'POST', body: formData });
    const { jobIds } = (await importRes.json()) as { jobIds: string[] };
    let job: { status: string; result?: { excludedCount: number } } | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      job = (await (await app.request(`/api/imports/${jobIds[0]}`)).json()) as typeof job;
      if (job?.status !== 'pending') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(job?.result).toMatchObject({ excludedCount: 1 });

    const patchRes = await app.request(`/api/exclusion-rules/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payer: 'patrice', pattern: 'UPDATED VENDOR' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { id: number; payer: string; pattern: string };
    expect(patched).toMatchObject({ id: created.id, payer: 'PATRICE', pattern: 'UPDATED VENDOR' });

    const deleteRes = await app.request(`/api/exclusion-rules/${created.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
    const afterDelete = (await (await app.request('/api/exclusion-rules')).json()) as { id: number }[];
    expect(afterDelete.some((r) => r.id === created.id)).toBe(false);
  });

  it('CRUDs variable-split vendor rules', async () => {
    const { app } = setup();

    const seeded = (await (await app.request('/api/variable-split-rules')).json()) as { id: number; pattern: string }[];
    expect(seeded.some((r) => r.pattern === 'Costco')).toBe(true);

    const createRes = await app.request('/api/variable-split-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'Whole Foods' }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { id: number; pattern: string };
    expect(created.pattern).toBe('Whole Foods');

    const patchRes = await app.request(`/api/variable-split-rules/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'Trader Joe\'s' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { id: number; pattern: string };
    expect(patched).toMatchObject({ id: created.id, pattern: 'Trader Joe\'s' });

    const deleteRes = await app.request(`/api/variable-split-rules/${created.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
    const afterDelete = (await (await app.request('/api/variable-split-rules')).json()) as { id: number }[];
    expect(afterDelete.some((r) => r.id === created.id)).toBe(false);
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
    const body = (await res.json()) as {
      transactions: {
        description: string;
        splitType: string;
        receiptMatch: { receiptId: number; status: string; aggregate: Record<string, number> } | null;
      }[];
      totalCount: number;
    };
    const { transactions } = body;
    expect(body.totalCount).toBe(3);

    expect(transactions.find((t) => t.description === 'Costco Wholesale')?.receiptMatch).toEqual({
      receiptId: seeded.receiptId,
      status: 'EXTRACTED',
      aggregate: { Brian: 50, Patrice: 50 },
    });
    expect(transactions.find((t) => t.description === 'Target')?.receiptMatch).toBeNull();
    expect(transactions.find((t) => t.description === 'Chipotle')?.receiptMatch).toBeNull();

    await prisma.receipt.update({ where: { id: seeded.receiptId }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    const afterSubmit = ((await (await app.request('/api/transactions')).json()) as typeof body).transactions;
    expect(afterSubmit.find((t) => t.description === 'Costco Wholesale')?.receiptMatch?.status).toBe('SUBMITTED');
  });

  it('edits a transaction split type and soft-deletes/undoes it, but blocks edits once synced', async () => {
    const { app } = setup();
    const transaction = await prisma.importedTransaction.create({
      data: { payer: 'Brian', date: '07/03/2026', description: 'Chipotle', amount: 25, splitType: 'Equally' },
    });

    const patchSplitType = await app.request(`/api/transactions/${transaction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ splitType: 'Variably' }),
    });
    expect(patchSplitType.status).toBe(200);
    const afterSplitTypeEdit = (await patchSplitType.json()) as { splitType: string };
    expect(afterSplitTypeEdit.splitType).toBe('Variably');

    const patchRemove = await app.request(`/api/transactions/${transaction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removed: true }),
    });
    expect(patchRemove.status).toBe(200);
    const afterRemove = (await patchRemove.json()) as { removed: boolean; removedAt: string | null };
    expect(afterRemove.removed).toBe(true);
    expect(afterRemove.removedAt).not.toBeNull();

    // The default status filter ('ACTIVE') excludes removed rows — this one
    // only shows up under the 'EXCLUDED_REMOVED' status.
    const listAfterRemove = (await (await app.request('/api/transactions?status=EXCLUDED_REMOVED')).json()) as {
      transactions: { id: number; removed: boolean }[];
    };
    expect(listAfterRemove.transactions.find((t) => t.id === transaction.id)?.removed).toBe(true);
    const listActiveAfterRemove = (await (await app.request('/api/transactions')).json()) as { transactions: { id: number }[] };
    expect(listActiveAfterRemove.transactions.some((t) => t.id === transaction.id)).toBe(false);

    const patchUndo = await app.request(`/api/transactions/${transaction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removed: false }),
    });
    expect(patchUndo.status).toBe(200);
    const afterUndo = (await patchUndo.json()) as { removed: boolean; removedAt: string | null };
    expect(afterUndo.removed).toBe(false);
    expect(afterUndo.removedAt).toBeNull();

    await prisma.importedTransaction.update({ where: { id: transaction.id }, data: { syncedAt: new Date() } });
    const blockedPatch = await app.request(`/api/transactions/${transaction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removed: true }),
    });
    expect(blockedPatch.status).toBe(400);
  });

  it('filters transactions by synced status and by import batch', async () => {
    const { app } = setup();
    const batchA = await prisma.importBatch.create({
      data: {
        title: 'Batch A',
        payer: 'Brian',
        minDate: '07/01/2026',
        maxDate: '07/01/2026',
        sourceFilename: 'a.csv',
        importedCount: 1,
        skippedDuplicateCount: 0,
        excludedCount: 0,
      },
    });
    const batchB = await prisma.importBatch.create({
      data: {
        title: 'Batch B',
        payer: 'Brian',
        minDate: '07/05/2026',
        maxDate: '07/05/2026',
        sourceFilename: 'b.csv',
        importedCount: 1,
        skippedDuplicateCount: 0,
        excludedCount: 0,
      },
    });
    await prisma.importedTransaction.createMany({
      data: [
        { payer: 'Brian', date: '07/01/2026', description: 'Unsynced in A', amount: 10, splitType: 'Equally', importBatchId: batchA.id },
        {
          payer: 'Brian',
          date: '07/01/2026',
          description: 'Synced in A',
          amount: 20,
          splitType: 'Equally',
          importBatchId: batchA.id,
          syncedAt: new Date(),
        },
        { payer: 'Brian', date: '07/05/2026', description: 'Unsynced in B', amount: 30, splitType: 'Equally', importBatchId: batchB.id },
      ],
    });

    type Body = { transactions: { description: string }[]; totalCount: number };

    // Default (status=ACTIVE, syncedStatus=UNSYNCED, no batch filter): both unsynced rows, across both batches.
    const defaultBody = (await (await app.request('/api/transactions')).json()) as Body;
    expect(defaultBody.transactions.map((t) => t.description).sort()).toEqual(['Unsynced in A', 'Unsynced in B']);

    // Scoping to batch A alone (still default synced filter) shows just its unsynced row.
    const batchABody = (await (await app.request(`/api/transactions?importBatchId=${batchA.id}`)).json()) as Body;
    expect(batchABody.transactions.map((t) => t.description)).toEqual(['Unsynced in A']);

    // syncedStatus=SYNCED, scoped to batch A, shows the synced row instead.
    const syncedBody = (await (await app.request(`/api/transactions?importBatchId=${batchA.id}&syncedStatus=SYNCED`)).json()) as Body;
    expect(syncedBody.transactions.map((t) => t.description)).toEqual(['Synced in A']);

    // syncedStatus=ALL, scoped to batch A, shows both.
    const allBody = (await (await app.request(`/api/transactions?importBatchId=${batchA.id}&syncedStatus=ALL`)).json()) as Body;
    expect(allBody.totalCount).toBe(2);
  });

  it('sorts and paginates transactions', async () => {
    const { app } = setup();
    await prisma.importedTransaction.createMany({
      data: [
        { payer: 'Brian', date: '07/01/2026', description: 'Low', amount: 10, splitType: 'Equally' },
        { payer: 'Brian', date: '07/02/2026', description: 'Mid', amount: 20, splitType: 'Equally' },
        { payer: 'Brian', date: '07/03/2026', description: 'High', amount: 30, splitType: 'Equally' },
      ],
    });

    type Body = { transactions: { description: string; amount: number }[]; totalCount: number };

    const desc = (await (await app.request('/api/transactions?sortBy=amount&sortDir=desc')).json()) as Body;
    expect(desc.transactions.map((t) => t.description)).toEqual(['High', 'Mid', 'Low']);

    const asc = (await (await app.request('/api/transactions?sortBy=amount&sortDir=asc')).json()) as Body;
    expect(asc.totalCount).toBe(3);
    expect(asc.transactions.map((t) => t.description)).toEqual(['Low', 'Mid', 'High']);

    const invalidPageSize = await app.request('/api/transactions?pageSize=7');
    expect(invalidPageSize.status).toBe(400);
  });

  it('paginates across pages with a fixed page size', async () => {
    const { app } = setup();
    await prisma.importedTransaction.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        payer: 'Brian',
        date: `07/${String(i + 1).padStart(2, '0')}/2026`,
        description: `Row ${String(i + 1).padStart(2, '0')}`,
        amount: i + 1,
        splitType: 'Equally' as const,
      })),
    });

    type Body = { transactions: { description: string }[]; totalCount: number };

    const page1 = (await (await app.request('/api/transactions?sortBy=date&sortDir=asc&page=1&pageSize=10')).json()) as Body;
    expect(page1.totalCount).toBe(12);
    expect(page1.transactions).toHaveLength(10);
    expect(page1.transactions[0].description).toBe('Row 01');

    const page2 = (await (await app.request('/api/transactions?sortBy=date&sortDir=asc&page=2&pageSize=10')).json()) as Body;
    expect(page2.totalCount).toBe(12);
    expect(page2.transactions).toHaveLength(2);
    expect(page2.transactions.map((t) => t.description)).toEqual(['Row 11', 'Row 12']);
  });

  it('never syncs a soft-removed transaction', async () => {
    const { app } = setup();
    const transaction = await prisma.importedTransaction.create({
      data: { payer: 'Brian', date: '07/03/2026', description: 'Chipotle', amount: 25, splitType: 'Equally' },
    });
    await app.request(`/api/transactions/${transaction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removed: true }),
    });

    const overview = (await (await app.request('/api/sync-overview')).json()) as { totalRows: number };
    expect(overview.totalRows).toBe(0);
  });

  type SyncRunJobJson = { status: string; result?: unknown; message?: string } | null;

  async function pollSyncRunCurrent(app: ReturnType<typeof createApp>): Promise<SyncRunJobJson> {
    let job: SyncRunJobJson = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      const res = await app.request('/api/sync-runs/current');
      job = (await res.json()) as SyncRunJobJson;
      if (job?.status !== 'pending') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return job;
  }

  it('previews and then runs a sync, marking synced transactions and recording history', async () => {
    const addTransactionsForPeriod = vi.fn(async () => ({ sheetName: 'x', rowsAdded: 1 }));
    const { app } = setup({ buildSheetsClient: () => ({ addTransactionsForPeriod }) });

    await prisma.importedTransaction.createMany({
      data: [
        { payer: 'Brian', date: '06/20/2026', description: 'Chipotle', amount: 25, splitType: 'Equally' },
        { payer: 'Brian', date: '07/02/2026', description: 'Chick-fil-A', amount: 12, splitType: 'Equally' },
      ],
    });

    const overview = (await (await app.request('/api/sync-overview')).json()) as { totalRows: number; groups: { payer: string; periodLabel: string; rowCount: number }[] };
    expect(overview.totalRows).toBe(2);
    expect(overview.groups.sort((a, b) => a.periodLabel.localeCompare(b.periodLabel))).toEqual([
      { payer: 'Brian', periodLabel: '06/26', rowCount: 1 },
      { payer: 'Brian', periodLabel: '07/26', rowCount: 1 },
    ]);

    const startRes = await app.request('/api/sync-runs', { method: 'POST' });
    expect(startRes.status).toBe(200);

    const job = await pollSyncRunCurrent(app);
    expect(job?.status).toBe('done');

    const runs = (await (await app.request('/api/sync-runs')).json()) as { status: string; periodResults: { status: string }[] }[];
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('DONE');
    expect(runs[0].periodResults.every((p) => p.status === 'SYNCED')).toBe(true);

    const staged = await prisma.importedTransaction.findMany();
    expect(staged.every((t) => t.syncedAt !== null)).toBe(true);
    expect(addTransactionsForPeriod).toHaveBeenCalledTimes(2);

    const overviewAfter = (await (await app.request('/api/sync-overview')).json()) as { totalRows: number };
    expect(overviewAfter.totalRows).toBe(0);
  });

  it('records a PARTIAL run when one tab fails, and only retries the failed one next time', async () => {
    const addTransactionsForPeriod = vi.fn(async (request: { periodLabel: string }) => {
      if (request.periodLabel === '07/26') {
        throw new Error('Sheets API boom');
      }
      return { sheetName: 'x', rowsAdded: 1 };
    });
    const { app } = setup({ buildSheetsClient: () => ({ addTransactionsForPeriod }) });

    await prisma.importedTransaction.createMany({
      data: [
        { payer: 'Brian', date: '06/20/2026', description: 'Chipotle', amount: 25, splitType: 'Equally' },
        { payer: 'Brian', date: '07/02/2026', description: 'Chick-fil-A', amount: 12, splitType: 'Equally' },
      ],
    });

    await app.request('/api/sync-runs', { method: 'POST' });
    await pollSyncRunCurrent(app);

    const runs = (await (await app.request('/api/sync-runs')).json()) as { status: string; periodResults: { periodLabel: string; status: string }[] }[];
    expect(runs[0].status).toBe('PARTIAL');
    expect(runs[0].periodResults.find((p) => p.periodLabel === '06/26')?.status).toBe('SYNCED');
    expect(runs[0].periodResults.find((p) => p.periodLabel === '07/26')?.status).toBe('FAILED');

    const overviewAfter = (await (await app.request('/api/sync-overview')).json()) as { totalRows: number };
    expect(overviewAfter.totalRows).toBe(1); // only the failed group's transaction is still unsynced

    // Fix the fake and retry — only the previously-failed tab should sync now.
    addTransactionsForPeriod.mockImplementation(async () => ({ sheetName: 'x', rowsAdded: 1 }));
    await app.request('/api/sync-runs', { method: 'POST' });
    await pollSyncRunCurrent(app);

    const runsAfterRetry = (await (await app.request('/api/sync-runs')).json()) as { status: string }[];
    expect(runsAfterRetry).toHaveLength(2);
    expect(runsAfterRetry[0].status).toBe('DONE');
    expect(await prisma.importedTransaction.count({ where: { syncedAt: null } })).toBe(0);
  });

  it('records an ERROR run when the Sheets client cannot even be built', async () => {
    const { app } = setup({
      buildSheetsClient: () => {
        throw new Error('No saved Google OAuth token');
      },
    });
    await prisma.importedTransaction.create({ data: { payer: 'Brian', date: '06/20/2026', description: 'Chipotle', amount: 25, splitType: 'Equally' } });

    await app.request('/api/sync-runs', { method: 'POST' });
    const job = await pollSyncRunCurrent(app);
    expect(job?.status).toBe('done'); // the failure is recorded as an ERROR-status run, not a job-level error

    const runs = (await (await app.request('/api/sync-runs')).json()) as { status: string; errorMessage: string | null }[];
    expect(runs[0].status).toBe('ERROR');
    expect(runs[0].errorMessage).toContain('No saved Google OAuth token');
    expect(await prisma.importedTransaction.count({ where: { syncedAt: { not: null } } })).toBe(0);
  });

  it('reports Google auth connection status and runs the reauthorize flow', async () => {
    let connected = false;
    const runAuthorizeFlow = vi.fn(async () => {
      connected = true;
    });
    const { app } = setup({ runAuthorizeFlow, hasSavedCredentials: () => connected });

    const before = (await (await app.request('/api/google-auth/status')).json()) as { connected: boolean; job: unknown };
    expect(before).toEqual({ connected: false, job: null });

    const startRes = await app.request('/api/google-auth/reauthorize', { method: 'POST' });
    expect(startRes.status).toBe(200);

    let status: { connected: boolean; job: { status: string } | null } | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      status = (await (await app.request('/api/google-auth/status')).json()) as typeof status;
      if (status?.job?.status !== 'pending') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(status?.job).toEqual({ status: 'done' });
    expect(status?.connected).toBe(true);
    expect(runAuthorizeFlow).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed reauthorize attempt', async () => {
    const runAuthorizeFlow = vi.fn(async () => {
      throw new Error('User closed the consent screen');
    });
    const { app } = setup({ runAuthorizeFlow, hasSavedCredentials: () => false });

    await app.request('/api/google-auth/reauthorize', { method: 'POST' });

    let status: { connected: boolean; job: { status: string; message?: string } | null } | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      status = (await (await app.request('/api/google-auth/status')).json()) as typeof status;
      if (status?.job?.status !== 'pending') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(status?.job).toEqual({ status: 'error', message: 'User closed the consent screen' });
    expect(status?.connected).toBe(false);
  });
});
