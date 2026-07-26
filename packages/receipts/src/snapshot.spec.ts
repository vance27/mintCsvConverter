import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSnapshot, writeSnapshotFile } from './snapshot.js';
import { readSnapshotFile, restoreSnapshot } from './restore.js';
import { createTestDb } from './testing/testDb.js';

describe('snapshot + restore round trip', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  async function seedSampleData() {
    const { prisma, cleanup } = createTestDb();
    cleanups.push(cleanup);

    const brian = await prisma.participant.create({ data: { name: 'Brian' } });
    const patrice = await prisma.participant.create({ data: { name: 'Patrice' } });
    const store = await prisma.store.create({ data: { name: 'Costco' } });
    const item = await prisma.item.create({
      data: { storeId: store.id, itemCode: '1164891', normalizedName: 'SILK ORG ALM', displayName: 'Silk Almond Milk', lastSeenName: 'SILK ORG.ALM' },
    });
    await prisma.itemSplitDefault.createMany({
      data: [
        { itemId: item.id, participantId: brian.id, percent: 60 },
        { itemId: item.id, participantId: patrice.id, percent: 40 },
      ],
    });
    const receipt = await prisma.receipt.create({
      data: {
        storeId: store.id,
        payerId: brian.id,
        sourceSha256: 'abc123',
        sourcePath: '/tmp/fake.pdf',
        purchaseDate: new Date('2026-07-24T00:00:00.000Z'),
        subtotal: 21.98,
        tax: 0,
        total: 21.98,
        cardAmount: 11.98,
        reconciled: true,
      },
    });
    await prisma.receiptTender.createMany({
      data: [
        { receiptId: receipt.id, kind: 'CARD', label: 'Card', amount: 11.98 },
        { receiptId: receipt.id, kind: 'CASH', label: 'Cash', amount: 10.0 },
      ],
    });
    const lineItem = await prisma.lineItem.create({
      data: { receiptId: receipt.id, itemId: item.id, rawItemCode: '1164891', rawName: 'SILK ORG.ALM', unitPrice: 10.99, quantity: 2, lineTotal: 21.98 },
    });
    await prisma.lineItemSplit.createMany({
      data: [
        { lineItemId: lineItem.id, participantId: brian.id, percent: 60 },
        { lineItemId: lineItem.id, participantId: patrice.id, percent: 40 },
      ],
    });
    await prisma.priceObservation.create({
      data: { itemId: item.id, receiptId: receipt.id, unitPrice: 10.99, quantity: 2, observedAt: new Date('2026-07-24T00:00:00.000Z') },
    });

    return { prisma };
  }

  it('produces a snapshot that restores byte-for-byte equivalent data into a fresh DB', async () => {
    const { prisma: sourceDb } = await seedSampleData();
    const snapshot = await createSnapshot(sourceDb);

    expect(snapshot.version).toBe(1);
    expect(snapshot.participants).toHaveLength(2);
    expect(snapshot.items[0]).toMatchObject({ itemCode: '1164891', displayName: 'Silk Almond Milk' });
    expect(snapshot.receipts[0]).toMatchObject({ purchaseDate: '2026-07-24T00:00:00.000Z', cardAmount: 11.98 });
    expect(snapshot.receiptTenders.map((t) => ({ receiptId: t.receiptId, kind: t.kind, label: t.label, amount: t.amount }))).toEqual([
      { receiptId: snapshot.receipts[0].id, kind: 'CARD', label: 'Card', amount: 11.98 },
      { receiptId: snapshot.receipts[0].id, kind: 'CASH', label: 'Cash', amount: 10.0 },
    ]);

    const { prisma: targetDb, cleanup } = createTestDb();
    cleanups.push(cleanup);
    await restoreSnapshot(targetDb, snapshot);

    const restoredSnapshot = await createSnapshot(targetDb);
    expect(restoredSnapshot).toEqual(snapshot);
  });

  it('writes and reads back an identical snapshot file', async () => {
    const { prisma } = await seedSampleData();
    const snapshot = await createSnapshot(prisma);

    const dir = mkdtempSync(join(tmpdir(), 'snapshot-test-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'snapshot.json');

    writeSnapshotFile(snapshot, path);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toContain('"version": 1');
    expect(readSnapshotFile(path)).toEqual(snapshot);
  });

  it('rejects a snapshot file with an unrecognized version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'snapshot-test-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'bad.json');
    writeSnapshotFile({ version: 99 as 1, participants: [], stores: [], items: [], itemSplitDefaults: [], priceObservations: [], receipts: [], receiptTenders: [], lineItems: [], lineItemSplits: [] }, path);

    expect(() => readSnapshotFile(path)).toThrow(/Unsupported snapshot version/);
  });

  it('restoring an empty snapshot clears an existing DB', async () => {
    const { prisma } = await seedSampleData();
    await expect(prisma.participant.count()).resolves.toBe(2);

    await restoreSnapshot(prisma, { version: 1, participants: [], stores: [], items: [], itemSplitDefaults: [], priceObservations: [], receipts: [], receiptTenders: [], lineItems: [], lineItemSplits: [] });

    await expect(prisma.participant.count()).resolves.toBe(0);
    await expect(prisma.receipt.count()).resolves.toBe(0);
  });
});
