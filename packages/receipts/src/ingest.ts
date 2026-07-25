import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extractReceipt } from './extractReceipt.js';
import type { VisionChatClient } from './ollamaClient.js';
import { reconcile } from './reconcile.js';
import { normalizeItemName } from './normalizeItemName.js';
import { aggregateSplits, evenPercentages, type AggregateLine } from './aggregate.js';
import { retainReceiptSource } from './receiptStorage.js';
import type { PrismaClient } from './db.js';
import type { Item, Participant } from './generated/prisma/client.js';
import type { ExtractedLineItem } from './types.js';

export interface IngestOptions {
  store: string;
  payer: string;
  model?: string;
}

export interface IngestDeps {
  prisma: PrismaClient;
  client: VisionChatClient;
  /** Override where retained source PDFs are copied to (tests only — defaults to the real ~/.config location). */
  receiptsBaseDir?: string;
}

export interface IngestResult {
  receiptId: number;
  /** True when a Receipt with this PDF's content hash already existed — nothing was re-ingested. */
  skipped: boolean;
  reconciled: boolean;
  newItemCount: number;
  /** Per-participant aggregate percentage for the whole receipt — the pair that lands in the sheet. */
  aggregate: Record<string, number>;
}

/**
 * Ingests one receipt PDF: extracts its line items via the VLM, resolves
 * each item by (store, itemCode) — falling back to a normalized name only
 * when no code is present — seeds each line's split from that item's
 * learned typical split (or an even default for a never-seen item), records
 * a price observation, reconciles the extraction, and persists everything
 * in one transaction. Idempotent: re-ingesting the same PDF (by content
 * hash) is a no-op.
 */
export async function ingestReceipt(pdfPath: string, options: IngestOptions, deps: IngestDeps): Promise<IngestResult> {
  const { prisma, client } = deps;
  const sourceSha256 = createHash('sha256').update(readFileSync(pdfPath)).digest('hex');

  const existing = await prisma.receipt.findUnique({ where: { sourceSha256 } });
  if (existing) {
    return { receiptId: existing.id, skipped: true, reconciled: existing.reconciled, newItemCount: 0, aggregate: {} };
  }

  const extracted = await extractReceipt(pdfPath, client, { store: options.store, model: options.model });
  const reconcileResult = reconcile(extracted);

  const store = await findOrCreateStore(prisma, options.store);
  const payer = await findParticipantOrThrow(prisma, options.payer);
  const activeParticipants = await prisma.participant.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
  if (activeParticipants.length === 0) {
    throw new Error('No active participants configured — seed at least one Participant before ingesting.');
  }

  let newItemCount = 0;
  const resolved: { item: Item; extractedItem: ExtractedLineItem; splitPercents: number[] }[] = [];
  const aggregateLines: AggregateLine[] = [];

  for (const extractedItem of extracted.items) {
    const { item, isNew, splitPercents } = await resolveItem(prisma, store.id, extractedItem, activeParticipants);
    if (isNew) {
      newItemCount++;
    }
    resolved.push({ item, extractedItem, splitPercents });
    aggregateLines.push({
      lineTotal: extractedItem.lineTotal,
      discountAmount: extractedItem.discountAmount,
      splits: Object.fromEntries(activeParticipants.map((p, i) => [p.name, splitPercents[i]])),
    });
  }

  const sourcePath = retainReceiptSource(pdfPath, sourceSha256, deps.receiptsBaseDir);
  const purchaseDate = new Date(extracted.purchaseDate);

  const receipt = await prisma.$transaction(async (tx) => {
    const created = await tx.receipt.create({
      data: {
        storeId: store.id,
        payerId: payer.id,
        sourceSha256,
        sourcePath,
        purchaseDate,
        subtotal: extracted.subtotal,
        tax: extracted.tax,
        total: extracted.total,
        status: 'EXTRACTED',
        reconciled: reconcileResult.reconciled,
      },
    });

    for (const { item, extractedItem, splitPercents } of resolved) {
      const lineItem = await tx.lineItem.create({
        data: {
          receiptId: created.id,
          itemId: item.id,
          rawItemCode: extractedItem.itemCode,
          rawName: extractedItem.rawName,
          unitPrice: extractedItem.unitPrice,
          quantity: extractedItem.quantity,
          lineTotal: extractedItem.lineTotal,
          discountAmount: extractedItem.discountAmount,
        },
      });

      await tx.lineItemSplit.createMany({
        data: activeParticipants.map((participant, i) => ({
          lineItemId: lineItem.id,
          participantId: participant.id,
          percent: splitPercents[i],
        })),
      });

      await tx.priceObservation.create({
        data: {
          itemId: item.id,
          receiptId: created.id,
          unitPrice: extractedItem.unitPrice,
          quantity: extractedItem.quantity,
          discountAmount: extractedItem.discountAmount,
          observedAt: purchaseDate,
        },
      });

      await tx.item.update({ where: { id: item.id }, data: { lastSeenName: extractedItem.rawName } });
    }

    return created;
  });

  const aggregate = aggregateSplits(
    aggregateLines,
    activeParticipants.map((p) => p.name),
  );

  return { receiptId: receipt.id, skipped: false, reconciled: reconcileResult.reconciled, newItemCount, aggregate };
}

async function resolveItem(
  prisma: PrismaClient,
  storeId: number,
  extractedItem: ExtractedLineItem,
  activeParticipants: Participant[],
): Promise<{ item: Item; isNew: boolean; splitPercents: number[] }> {
  const normalizedName = normalizeItemName(extractedItem.rawName);

  const item = extractedItem.itemCode
    ? await prisma.item.findUnique({ where: { storeId_itemCode: { storeId, itemCode: extractedItem.itemCode } } })
    : await prisma.item.findUnique({ where: { storeId_normalizedName: { storeId, normalizedName } } });

  if (item) {
    const defaults = await prisma.itemSplitDefault.findMany({ where: { itemId: item.id } });
    const splitPercents =
      defaults.length > 0
        ? activeParticipants.map((p) => defaults.find((d) => d.participantId === p.id)?.percent ?? 0)
        : evenPercentages(activeParticipants.length);
    return { item, isNew: false, splitPercents };
  }

  const created = await prisma.item.create({
    data: {
      storeId,
      itemCode: extractedItem.itemCode,
      normalizedName,
      lastSeenName: extractedItem.rawName,
    },
  });
  return { item: created, isNew: true, splitPercents: evenPercentages(activeParticipants.length) };
}

async function findOrCreateStore(prisma: PrismaClient, name: string) {
  const existing = await prisma.store.findUnique({ where: { name } });
  if (existing) {
    return existing;
  }
  return prisma.store.create({ data: { name } });
}

async function findParticipantOrThrow(prisma: PrismaClient, name: string): Promise<Participant> {
  const participant = await prisma.participant.findUnique({ where: { name } });
  if (!participant) {
    throw new Error(`No participant named "${name}" — seed participants before ingesting.`);
  }
  return participant;
}
