import { readFileSync } from 'node:fs';
import type { PrismaClient } from './db.js';
import { defaultSnapshotPath, type DatastoreSnapshot } from './snapshot.js';

/** Reads and lightly validates a snapshot file (checks its version tag). Accepts v1 files (predating payerExclusionRules/variableSplitRules) as well as the current v2. */
export function readSnapshotFile(path: string = defaultSnapshotPath()): DatastoreSnapshot {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as DatastoreSnapshot;
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error(`Unsupported snapshot version: ${String(parsed.version)}`);
  }
  return parsed;
}

/**
 * Rebuilds the datastore from a snapshot: wipes all tables and re-inserts
 * in dependency order, preserving original IDs (the snapshot's foreign
 * keys reference them, and SQLite's AUTOINCREMENT tracks the highest ID
 * it has ever held, so future inserts won't collide). Used both to
 * restore a backup and to bootstrap a fresh machine.
 */
export async function restoreSnapshot(prisma: PrismaClient, snapshot: DatastoreSnapshot): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.lineItemSplit.deleteMany();
    await tx.priceObservation.deleteMany();
    await tx.lineItem.deleteMany();
    await tx.itemSplitDefault.deleteMany();
    await tx.receiptTender.deleteMany();
    await tx.receipt.deleteMany();
    await tx.item.deleteMany();
    await tx.store.deleteMany();
    await tx.participant.deleteMany();
    await tx.payerExclusionRule.deleteMany();
    await tx.variableSplitRule.deleteMany();
    await tx.csvImportProfile.deleteMany();

    if (snapshot.participants.length > 0) {
      await tx.participant.createMany({ data: snapshot.participants });
    }
    if (snapshot.stores.length > 0) {
      await tx.store.createMany({ data: snapshot.stores });
    }
    if (snapshot.items.length > 0) {
      await tx.item.createMany({ data: snapshot.items.map((i) => ({ ...i, createdAt: new Date(i.createdAt) })) });
    }
    if (snapshot.receipts.length > 0) {
      await tx.receipt.createMany({
        data: snapshot.receipts.map((r) => ({
          ...r,
          purchaseDate: new Date(r.purchaseDate),
          createdAt: new Date(r.createdAt),
          submittedAt: r.submittedAt ? new Date(r.submittedAt) : null,
        })),
      });
    }
    if (snapshot.receiptTenders.length > 0) {
      await tx.receiptTender.createMany({ data: snapshot.receiptTenders });
    }
    if (snapshot.lineItems.length > 0) {
      await tx.lineItem.createMany({ data: snapshot.lineItems });
    }
    if (snapshot.itemSplitDefaults.length > 0) {
      await tx.itemSplitDefault.createMany({ data: snapshot.itemSplitDefaults });
    }
    if (snapshot.lineItemSplits.length > 0) {
      await tx.lineItemSplit.createMany({ data: snapshot.lineItemSplits });
    }
    if (snapshot.priceObservations.length > 0) {
      await tx.priceObservation.createMany({ data: snapshot.priceObservations.map((o) => ({ ...o, observedAt: new Date(o.observedAt) })) });
    }
    const payerExclusionRules = snapshot.payerExclusionRules ?? [];
    if (payerExclusionRules.length > 0) {
      await tx.payerExclusionRule.createMany({ data: payerExclusionRules.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })) });
    }
    const variableSplitRules = snapshot.variableSplitRules ?? [];
    if (variableSplitRules.length > 0) {
      await tx.variableSplitRule.createMany({ data: variableSplitRules.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })) });
    }
    const csvImportProfiles = snapshot.csvImportProfiles ?? [];
    if (csvImportProfiles.length > 0) {
      await tx.csvImportProfile.createMany({
        data: csvImportProfiles.map((p) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          lastUsedAt: p.lastUsedAt ? new Date(p.lastUsedAt) : null,
        })),
      });
    }
  });
}

/** Convenience: reads the snapshot file at `path` (default location if omitted) and restores it. */
export async function restoreFromFile(prisma: PrismaClient, path?: string): Promise<void> {
  await restoreSnapshot(prisma, readSnapshotFile(path));
}
