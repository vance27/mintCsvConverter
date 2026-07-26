import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestReceipt, type IngestDeps } from './ingest.js';
import { seedParticipants } from './seed.js';
import { createTestDb } from './testing/testDb.js';
import type { VisionChatClient } from './ollamaClient.js';

function fakeClient(content: unknown): VisionChatClient {
  return { chat: vi.fn(async () => ({ message: { content: JSON.stringify(content) } })) };
}

/** Writes a minimal, distinct-content receipt PDF (varying width keeps the sha256 unique per test scenario). */
function writeFixturePdf(dir: string, name: string, width = 200): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} 200]/Resources<<>>>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n`,
  );
  return path;
}

const RECEIPT_JSON = {
  store: 'Costco',
  purchaseDate: '2026-07-24',
  subtotal: 21.98,
  tax: 0,
  total: 21.98,
  items: [{ itemCode: '1164891', rawName: 'SILK ORG.ALM', quantity: 2, unitPrice: 10.99, lineTotal: 21.98, taxable: false, discountAmount: 0 }],
};

describe('ingestReceipt', () => {
  const tempDirs: string[] = [];
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    const { prisma, cleanup } = createTestDb();
    cleanups.push(cleanup);
    const workDir = mkdtempSync(join(tmpdir(), 'ingest-test-'));
    tempDirs.push(workDir);
    return { prisma, workDir };
  }

  it('ingests a new receipt with a never-before-seen item, defaulting to an even split', async () => {
    const { prisma, workDir } = setup();
    await seedParticipants(prisma, ['Brian', 'Patrice']);
    const pdfPath = writeFixturePdf(workDir, 'r1.pdf');
    const deps: IngestDeps = { prisma, client: fakeClient(RECEIPT_JSON), receiptsBaseDir: join(workDir, 'store') };

    const result = await ingestReceipt(pdfPath, { store: 'Costco', payer: 'Brian' }, deps);

    expect(result.skipped).toBe(false);
    expect(result.newItemCount).toBe(1);
    expect(result.reconciled).toBe(true);
    expect(result.aggregate).toEqual({ Brian: 50, Patrice: 50 });
    expect(result.cardAmount).toBe(21.98);

    const lineItem = await prisma.lineItem.findFirstOrThrow({ where: { receiptId: result.receiptId }, include: { splits: true } });
    expect(lineItem.splits).toHaveLength(2);
    expect(lineItem.splits.map((s) => s.percent).sort()).toEqual([50, 50]);
  });

  it('seeds a repeat item’s split from its learned ItemSplitDefault instead of an even split', async () => {
    const { prisma, workDir } = setup();
    const [brian, patrice] = await Promise.all([
      prisma.participant.create({ data: { name: 'Brian' } }),
      prisma.participant.create({ data: { name: 'Patrice' } }),
    ]);
    const store = await prisma.store.create({ data: { name: 'Costco' } });
    const item = await prisma.item.create({
      data: { storeId: store.id, itemCode: '1164891', normalizedName: 'SILK ORG ALM', lastSeenName: 'SILK ORG.ALM' },
    });
    await prisma.itemSplitDefault.createMany({
      data: [
        { itemId: item.id, participantId: brian.id, percent: 70 },
        { itemId: item.id, participantId: patrice.id, percent: 30 },
      ],
    });

    const pdfPath = writeFixturePdf(workDir, 'r2.pdf');
    const deps: IngestDeps = { prisma, client: fakeClient(RECEIPT_JSON), receiptsBaseDir: join(workDir, 'store') };
    const result = await ingestReceipt(pdfPath, { store: 'Costco', payer: 'Brian' }, deps);

    expect(result.newItemCount).toBe(0);
    expect(result.aggregate).toEqual({ Brian: 70, Patrice: 30 });
  });

  it('is idempotent — re-ingesting the same PDF content is a no-op', async () => {
    const { prisma, workDir } = setup();
    await seedParticipants(prisma, ['Brian', 'Patrice']);
    const pdfPath = writeFixturePdf(workDir, 'r3.pdf');
    const deps: IngestDeps = { prisma, client: fakeClient(RECEIPT_JSON), receiptsBaseDir: join(workDir, 'store') };

    const first = await ingestReceipt(pdfPath, { store: 'Costco', payer: 'Brian' }, deps);
    const second = await ingestReceipt(pdfPath, { store: 'Costco', payer: 'Brian' }, deps);

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(second.receiptId).toBe(first.receiptId);
    await expect(prisma.receipt.count()).resolves.toBe(1);
  });

  it('flags a receipt as unreconciled when the extraction is internally inconsistent, without blocking ingest', async () => {
    const { prisma, workDir } = setup();
    await seedParticipants(prisma, ['Brian', 'Patrice']);
    const pdfPath = writeFixturePdf(workDir, 'r4.pdf');
    const badJson = { ...RECEIPT_JSON, total: 999 };
    const deps: IngestDeps = { prisma, client: fakeClient(badJson), receiptsBaseDir: join(workDir, 'store') };

    const result = await ingestReceipt(pdfPath, { store: 'Costco', payer: 'Brian' }, deps);

    expect(result.skipped).toBe(false);
    expect(result.reconciled).toBe(false);
    await expect(prisma.receipt.count()).resolves.toBe(1);
  });

  it('persists a tender breakdown and uses only the card portion for cardAmount when a purchase is split across tender types', async () => {
    const { prisma, workDir } = setup();
    await seedParticipants(prisma, ['Brian', 'Patrice']);
    const pdfPath = writeFixturePdf(workDir, 'r6.pdf');
    const splitTenderJson = {
      ...RECEIPT_JSON,
      tenders: [
        { kind: 'CARD', label: 'Card', amount: 11.98 },
        { kind: 'CASH', label: 'Cash', amount: 10.0 },
      ],
    };
    const deps: IngestDeps = { prisma, client: fakeClient(splitTenderJson), receiptsBaseDir: join(workDir, 'store') };

    const result = await ingestReceipt(pdfPath, { store: 'Costco', payer: 'Brian' }, deps);

    expect(result.cardAmount).toBeCloseTo(11.98);
    const tenders = await prisma.receiptTender.findMany({ where: { receiptId: result.receiptId } });
    expect(tenders.map((t) => ({ kind: t.kind, amount: t.amount }))).toEqual([
      { kind: 'CARD', amount: 11.98 },
      { kind: 'CASH', amount: 10.0 },
    ]);
  });

  it('throws a clear error when the payer is not a seeded participant', async () => {
    const { prisma, workDir } = setup();
    await seedParticipants(prisma, ['Brian']);
    const pdfPath = writeFixturePdf(workDir, 'r5.pdf');
    const deps: IngestDeps = { prisma, client: fakeClient(RECEIPT_JSON), receiptsBaseDir: join(workDir, 'store') };

    await expect(ingestReceipt(pdfPath, { store: 'Costco', payer: 'Nobody' }, deps)).rejects.toThrow(/No participant named "Nobody"/);
  });
});
