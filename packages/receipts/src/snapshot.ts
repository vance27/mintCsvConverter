import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from './db.js';
import type { ReceiptStatus } from './generated/prisma/enums.js';

export interface ParticipantSnapshotRow {
    id: number;
    name: string;
    active: boolean;
}
export interface StoreSnapshotRow {
    id: number;
    name: string;
}
export interface ItemSnapshotRow {
    id: number;
    storeId: number;
    itemCode: string | null;
    normalizedName: string | null;
    displayName: string | null;
    lastSeenName: string;
    createdAt: string;
}
export interface ItemSplitDefaultSnapshotRow {
    id: number;
    itemId: number;
    participantId: number;
    percent: number;
}
export interface PriceObservationSnapshotRow {
    id: number;
    itemId: number;
    receiptId: number;
    unitPrice: number;
    quantity: number;
    discountAmount: number;
    observedAt: string;
}
export interface ReceiptSnapshotRow {
    id: number;
    storeId: number;
    payerId: number;
    sourceSha256: string;
    sourcePath: string;
    originalFilename: string | null;
    purchaseDate: string | null;
    subtotal: number | null;
    tax: number | null;
    total: number | null;
    cardAmount: number | null;
    status: ReceiptStatus;
    submittedAt: string | null;
    reconciled: boolean;
    createdAt: string;
    extractionError: string | null;
}
export interface ReceiptTenderSnapshotRow {
    id: number;
    receiptId: number;
    kind: string;
    label: string;
    amount: number;
}
export interface LineItemSnapshotRow {
    id: number;
    receiptId: number;
    itemId: number | null;
    rawItemCode: string | null;
    rawName: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    discountAmount: number;
    reviewed: boolean;
}
export interface LineItemSplitSnapshotRow {
    id: number;
    lineItemId: number;
    participantId: number;
    percent: number;
}
export interface PayerExclusionRuleSnapshotRow {
    id: number;
    payer: string;
    pattern: string;
    note: string | null;
    createdAt: string;
}
export interface VariableSplitRuleSnapshotRow {
    id: number;
    pattern: string;
    note: string | null;
    createdAt: string;
}
export interface CsvImportProfileSnapshotRow {
    id: number;
    name: string;
    hasHeader: boolean;
    columnCount: number;
    headerSignature: string | null;
    columnMappingJson: string;
    createdAt: string;
    lastUsedAt: string | null;
}

export interface DatastoreSnapshot {
    version: 1 | 2;
    participants: ParticipantSnapshotRow[];
    stores: StoreSnapshotRow[];
    items: ItemSnapshotRow[];
    itemSplitDefaults: ItemSplitDefaultSnapshotRow[];
    priceObservations: PriceObservationSnapshotRow[];
    receipts: ReceiptSnapshotRow[];
    receiptTenders: ReceiptTenderSnapshotRow[];
    lineItems: LineItemSnapshotRow[];
    lineItemSplits: LineItemSplitSnapshotRow[];
    // Absent (undefined) when read from a v1 snapshot file — restoreSnapshot
    // treats that the same as an empty array. Always present, never
    // undefined, on snapshots createSnapshot itself writes (version 2).
    payerExclusionRules?: PayerExclusionRuleSnapshotRow[];
    variableSplitRules?: VariableSplitRuleSnapshotRow[];
    // Same v1/early-v2-compat story as the two fields above — absent on any
    // snapshot predating CsvImportProfile.
    csvImportProfiles?: CsvImportProfileSnapshotRow[];
}

/** Where the local JSON backup lives (gitignored — see costco-receipt-importer.md's "SQLite vs Postgres, and git-versioned backups" section for the original rationale; no longer actually committed). */
export function defaultSnapshotPath(): string {
    return fileURLToPath(new URL('../data/snapshot.json', import.meta.url));
}

/**
 * Exports the whole datastore to a plain, deterministically-ordered JSON
 * structure — a local, human-reviewable backup (gitignored, not committed).
 */
export async function createSnapshot(prisma: PrismaClient): Promise<DatastoreSnapshot> {
    const [
        participants,
        stores,
        items,
        itemSplitDefaults,
        priceObservations,
        receipts,
        receiptTenders,
        lineItems,
        lineItemSplits,
        payerExclusionRules,
        variableSplitRules,
        csvImportProfiles,
    ] = await Promise.all([
        prisma.participant.findMany({ orderBy: { id: 'asc' } }),
        prisma.store.findMany({ orderBy: { id: 'asc' } }),
        prisma.item.findMany({ orderBy: { id: 'asc' } }),
        prisma.itemSplitDefault.findMany({ orderBy: { id: 'asc' } }),
        prisma.priceObservation.findMany({ orderBy: { id: 'asc' } }),
        prisma.receipt.findMany({ orderBy: { id: 'asc' } }),
        prisma.receiptTender.findMany({ orderBy: { id: 'asc' } }),
        prisma.lineItem.findMany({ orderBy: { id: 'asc' } }),
        prisma.lineItemSplit.findMany({ orderBy: { id: 'asc' } }),
        prisma.payerExclusionRule.findMany({ orderBy: { id: 'asc' } }),
        prisma.variableSplitRule.findMany({ orderBy: { id: 'asc' } }),
        prisma.csvImportProfile.findMany({ orderBy: { id: 'asc' } }),
    ]);

    return {
        version: 2,
        participants: participants.map((p) => ({ id: p.id, name: p.name, active: p.active })),
        stores: stores.map((s) => ({ id: s.id, name: s.name })),
        items: items.map((i) => ({
            id: i.id,
            storeId: i.storeId,
            itemCode: i.itemCode,
            normalizedName: i.normalizedName,
            displayName: i.displayName,
            lastSeenName: i.lastSeenName,
            createdAt: i.createdAt.toISOString(),
        })),
        itemSplitDefaults: itemSplitDefaults.map((d) => ({
            id: d.id,
            itemId: d.itemId,
            participantId: d.participantId,
            percent: d.percent,
        })),
        priceObservations: priceObservations.map((o) => ({
            id: o.id,
            itemId: o.itemId,
            receiptId: o.receiptId,
            unitPrice: o.unitPrice,
            quantity: o.quantity,
            discountAmount: o.discountAmount,
            observedAt: o.observedAt.toISOString(),
        })),
        receipts: receipts.map((r) => ({
            id: r.id,
            storeId: r.storeId,
            payerId: r.payerId,
            sourceSha256: r.sourceSha256,
            sourcePath: r.sourcePath,
            originalFilename: r.originalFilename,
            purchaseDate: r.purchaseDate ? r.purchaseDate.toISOString() : null,
            subtotal: r.subtotal,
            tax: r.tax,
            total: r.total,
            cardAmount: r.cardAmount,
            status: r.status,
            submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
            reconciled: r.reconciled,
            createdAt: r.createdAt.toISOString(),
            extractionError: r.extractionError,
        })),
        receiptTenders: receiptTenders.map((t) => ({
            id: t.id,
            receiptId: t.receiptId,
            kind: t.kind,
            label: t.label,
            amount: t.amount,
        })),
        lineItems: lineItems.map((l) => ({
            id: l.id,
            receiptId: l.receiptId,
            itemId: l.itemId,
            rawItemCode: l.rawItemCode,
            rawName: l.rawName,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            lineTotal: l.lineTotal,
            discountAmount: l.discountAmount,
            reviewed: l.reviewed,
        })),
        lineItemSplits: lineItemSplits.map((s) => ({
            id: s.id,
            lineItemId: s.lineItemId,
            participantId: s.participantId,
            percent: s.percent,
        })),
        payerExclusionRules: payerExclusionRules.map((r) => ({
            id: r.id,
            payer: r.payer,
            pattern: r.pattern,
            note: r.note,
            createdAt: r.createdAt.toISOString(),
        })),
        variableSplitRules: variableSplitRules.map((r) => ({
            id: r.id,
            pattern: r.pattern,
            note: r.note,
            createdAt: r.createdAt.toISOString(),
        })),
        csvImportProfiles: csvImportProfiles.map((p) => ({
            id: p.id,
            name: p.name,
            hasHeader: p.hasHeader,
            columnCount: p.columnCount,
            headerSignature: p.headerSignature,
            columnMappingJson: p.columnMappingJson,
            createdAt: p.createdAt.toISOString(),
            lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
        })),
    };
}

/** Writes a snapshot to disk as pretty-printed, deterministic JSON (stable line-by-line diffs across runs). */
export function writeSnapshotFile(snapshot: DatastoreSnapshot, path: string = defaultSnapshotPath()): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}
