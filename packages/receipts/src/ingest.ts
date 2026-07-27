import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { extractReconciledReceipt } from './extractReconciled.js';
import type { VisionChatClient } from './ollamaClient.js';
import { cardAmount } from './tender.js';
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
  /** Portion of the receipt total charged to a card — the amount that will match a Citi CSV transaction (see tender.ts). */
  cardAmount: number;
  /** How many extraction attempts it took to reconcile (0 when skipped, 1 when it reconciled on the first try) — see extractReconciled.ts. */
  attempts: number;
}

export interface QueueReceiptResult {
  receiptId: number;
  /** True when this hash already had a Receipt row that's already queued, in progress, extracted, or submitted — nothing new was created. */
  alreadyQueued: boolean;
}

/**
 * Fast half of ingestion: hashes the file, retains it to permanent storage,
 * resolves store/payer, and creates a placeholder Receipt row (status
 * QUEUED) — or reuses an existing one by content hash, which is what makes
 * re-uploading the same PDF idempotent. A row stuck FAILED from a prior
 * attempt is reset to QUEUED and reused rather than duplicated, so retrying
 * doesn't require re-uploading. Does no VLM work — safe to await directly
 * from an HTTP request handler.
 */
export async function queueReceiptForIngest(
  pdfPath: string,
  options: IngestOptions,
  deps: IngestDeps,
): Promise<QueueReceiptResult> {
  const { prisma } = deps;
  const sourceSha256 = createHash('sha256').update(readFileSync(pdfPath)).digest('hex');

  const existing = await prisma.receipt.findUnique({ where: { sourceSha256 } });
  if (existing) {
    if (existing.status === 'FAILED') {
      await prisma.receipt.update({ where: { id: existing.id }, data: { status: 'QUEUED', extractionError: null } });
      return { receiptId: existing.id, alreadyQueued: false };
    }
    // EXTRACTED/SUBMITTED (already fully done), or QUEUED/EXTRACTING (a
    // genuine concurrent duplicate upload of the same bytes, already in
    // flight) — either way there's nothing new to enqueue.
    return { receiptId: existing.id, alreadyQueued: true };
  }

  const store = await findOrCreateStore(prisma, options.store);
  const payer = await findParticipantOrThrow(prisma, options.payer);
  const sourcePath = retainReceiptSource(pdfPath, sourceSha256, deps.receiptsBaseDir);

  const created = await prisma.receipt.create({
    data: {
      storeId: store.id,
      payerId: payer.id,
      sourceSha256,
      sourcePath,
      originalFilename: basename(pdfPath),
      status: 'QUEUED',
    },
  });
  return { receiptId: created.id, alreadyQueued: false };
}

/**
 * Slow half of ingestion: runs the VLM extraction/reconciliation against an
 * already-queued receipt's retained PDF, then fills in the same placeholder
 * row in place (rather than creating a new one) plus its LineItem/
 * LineItemSplit/ReceiptTender/PriceObservation rows, all in one transaction.
 * On a thrown extraction error, the row is marked FAILED with the error
 * message instead of being left stuck EXTRACTING forever. A failed
 * *reconciliation* (the extraction succeeded but its arithmetic doesn't add
 * up) is not an error here — that still lands on EXTRACTED with
 * reconciled: false, exactly as before this split existed.
 */
export async function runIngestExtraction(receiptId: number, deps: IngestDeps, options: { model?: string } = {}): Promise<IngestResult> {
  const { prisma, client } = deps;
  try {
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId }, include: { store: true } });
    await prisma.receipt.update({ where: { id: receiptId }, data: { status: 'EXTRACTING' } });

    const {
      receipt: extracted,
      reconcile: reconcileResult,
      attempts,
    } = await extractReconciledReceipt(receipt.sourcePath, client, { store: receipt.store.name, model: options.model });

    const activeParticipants = await prisma.participant.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
    if (activeParticipants.length === 0) {
      throw new Error('No active participants configured — seed at least one Participant before ingesting.');
    }

    let newItemCount = 0;
    const resolved: { item: Item; extractedItem: ExtractedLineItem; splitPercents: number[] }[] = [];
    const aggregateLines: AggregateLine[] = [];

    for (const extractedItem of extracted.items) {
      const { item, isNew, splitPercents } = await resolveItem(prisma, receipt.storeId, extractedItem, activeParticipants);
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

    const purchaseDate = new Date(extracted.purchaseDate);
    const cardAmountValue = cardAmount(extracted.tenders, extracted.total);

    await prisma.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id: receiptId },
        data: {
          purchaseDate,
          subtotal: extracted.subtotal,
          tax: extracted.tax,
          total: extracted.total,
          cardAmount: cardAmountValue,
          status: 'EXTRACTED',
          reconciled: reconcileResult.reconciled,
        },
      });

      if (extracted.tenders.length > 0) {
        await tx.receiptTender.createMany({
          data: extracted.tenders.map((tender) => ({
            receiptId,
            kind: tender.kind,
            label: tender.label,
            amount: tender.amount,
          })),
        });
      }

      for (const { item, extractedItem, splitPercents } of resolved) {
        const lineItem = await tx.lineItem.create({
          data: {
            receiptId,
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
            receiptId,
            unitPrice: extractedItem.unitPrice,
            quantity: extractedItem.quantity,
            discountAmount: extractedItem.discountAmount,
            observedAt: purchaseDate,
          },
        });

        await tx.item.update({ where: { id: item.id }, data: { lastSeenName: extractedItem.rawName } });
      }
    });

    const aggregate = aggregateSplits(
      aggregateLines,
      activeParticipants.map((p) => p.name),
    );

    return {
      receiptId,
      skipped: false,
      reconciled: reconcileResult.reconciled,
      newItemCount,
      aggregate,
      cardAmount: cardAmountValue,
      attempts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      // Best-effort: marking FAILED is what takes this row out of the QUEUED
      // pool so the upload queue's drain loop doesn't pick it right back up
      // and retry forever. If even this write fails (e.g. the DB itself is
      // unreachable), there's nothing more to do here — the circuit breaker
      // in UploadQueue.drain() is the backstop for that case.
      await prisma.receipt.update({ where: { id: receiptId }, data: { status: 'FAILED', extractionError: message } });
    } catch {
      // Original error below is what matters; a failure to persist FAILED
      // status is not itself worth surfacing over that.
    }
    throw error;
  }
}

/**
 * Ingests one receipt PDF end-to-end: queues it (idempotent by content
 * hash), then immediately runs extraction — the original one-call contract,
 * kept for the CLI and for tests that don't need queue semantics. The
 * upload queue (packages/receipt-review's UploadQueue) instead calls
 * queueReceiptForIngest/runIngestExtraction separately so it can enforce
 * one-at-a-time extraction across concurrent uploads.
 */
export async function ingestReceipt(pdfPath: string, options: IngestOptions, deps: IngestDeps): Promise<IngestResult> {
  const { receiptId, alreadyQueued } = await queueReceiptForIngest(pdfPath, options, deps);
  if (alreadyQueued) {
    const existing = await deps.prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    return {
      receiptId,
      skipped: true,
      reconciled: existing.reconciled,
      newItemCount: 0,
      aggregate: {},
      cardAmount: existing.cardAmount ?? existing.total ?? 0,
      attempts: 0,
    };
  }
  return runIngestExtraction(receiptId, deps, { model: options.model });
}

async function resolveItem(
  prisma: PrismaClient,
  storeId: number,
  extractedItem: ExtractedLineItem,
  activeParticipants: Participant[],
): Promise<{ item: Item; isNew: boolean; splitPercents: number[] }> {
  const normalizedName = normalizeItemName(extractedItem.rawName);

  // itemCode is the preferred key, but a misread digit (confirmed against a
  // real receipt: one-off OCR error on an item code) means an itemCode miss
  // doesn't necessarily mean the item is new — fall back to normalizedName
  // before creating, so a fresh Item.create() doesn't collide with a
  // different pre-existing item that happens to share that name.
  const item =
    (extractedItem.itemCode
      ? await prisma.item.findUnique({ where: { storeId_itemCode: { storeId, itemCode: extractedItem.itemCode } } })
      : null) ?? (await prisma.item.findUnique({ where: { storeId_normalizedName: { storeId, normalizedName } } }));

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
