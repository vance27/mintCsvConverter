import { normalizeItemName } from './normalizeItemName.js';
import { evenPercentages } from './aggregate.js';
import type { PrismaClient } from './db.js';
import { Prisma, type Item, type Participant, type Store } from './generated/prisma/client.js';
import type { ExtractedLineItem } from './types.js';

/**
 * Resolves a Store by name, creating it if it doesn't already exist. Shared
 * by ingest.ts (queueing a new receipt) and packages/receipt-review's
 * review-time Store correction (docs/adr/0010), so both paths resolve a
 * declared store name identically.
 */
export async function findOrCreateStore(prisma: PrismaClient, name: string): Promise<Store> {
    const existing = await prisma.store.findUnique({ where: { name } });
    if (existing) {
        return existing;
    }
    return prisma.store.create({ data: { name } });
}

async function splitPercentsFor(
    prisma: PrismaClient,
    itemId: number,
    activeParticipants: Participant[],
): Promise<number[]> {
    const defaults = await prisma.itemSplitDefault.findMany({ where: { itemId } });
    return defaults.length > 0
        ? activeParticipants.map((p) => defaults.find((d) => d.participantId === p.id)?.percent ?? 0)
        : evenPercentages(activeParticipants.length);
}

/**
 * Resolves an extracted (or hand-entered) line item to its Item row —
 * matching by itemCode first, falling back to normalizedName, creating a new
 * Item when neither matches — and seeds its split from that Item's learned
 * ItemSplitDefault (or an even split for a brand-new Item). Shared by
 * ingest.ts's per-item extraction loop and packages/receipt-review's
 * review-time mutations (adding a line, correcting an item code) so both
 * paths resolve identically (docs/adr/0009).
 */
export async function resolveItem(
    prisma: PrismaClient,
    storeId: number,
    extractedItem: ExtractedLineItem,
    activeParticipants: Participant[],
): Promise<{ item: Item; isNew: boolean; splitPercents: number[] }> {
    // A blank rawName (the model sometimes fails to read a name at all) has
    // no real dedup signal — store null rather than "", so Item's
    // @@unique([storeId, normalizedName]) constraint never treats two
    // unrelated unidentifiable lines as the same item (SQL never considers
    // two NULLs equal, unlike two empty strings, which previously merged
    // them into one shared garbage Item).
    const normalizedName = normalizeItemName(extractedItem.rawName) || null;

    // itemCode is the preferred key, but a misread digit (confirmed against a
    // real receipt: one-off OCR error on an item code) means an itemCode miss
    // doesn't necessarily mean the item is new — fall back to normalizedName
    // before creating, so a fresh Item.create() doesn't collide with a
    // different pre-existing item that happens to share that name. That
    // fallback only makes sense when there's an actual name to match on.
    const item =
        (extractedItem.itemCode
            ? await prisma.item.findUnique({
                  where: { storeId_itemCode: { storeId, itemCode: extractedItem.itemCode } },
              })
            : null) ??
        (normalizedName
            ? await prisma.item.findUnique({ where: { storeId_normalizedName: { storeId, normalizedName } } })
            : null);

    if (item) {
        return { item, isNew: false, splitPercents: await splitPercentsFor(prisma, item.id, activeParticipants) };
    }

    try {
        const created = await prisma.item.create({
            data: {
                storeId,
                itemCode: extractedItem.itemCode,
                normalizedName,
                lastSeenName: extractedItem.rawName,
            },
        });
        return { item: created, isNew: true, splitPercents: evenPercentages(activeParticipants.length) };
    } catch (error) {
        // A unique-constraint collision here means a matching row already
        // exists that the lookup above missed — e.g. a leftover Item from an
        // earlier attempt on this same receipt that failed partway through
        // (Item creation isn't part of the transaction below, so it survives a
        // later failure). Reuse the existing row instead of crashing the whole
        // extraction over one that's trivially findable.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && extractedItem.itemCode) {
            const existing = await prisma.item.findUniqueOrThrow({
                where: { storeId_itemCode: { storeId, itemCode: extractedItem.itemCode } },
            });
            return {
                item: existing,
                isNew: false,
                splitPercents: await splitPercentsFor(prisma, existing.id, activeParticipants),
            };
        }
        throw error;
    }
}
