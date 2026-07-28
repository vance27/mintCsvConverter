import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import { ReceiptStatus, listManifestEntries, type PrismaClient } from '@mint-csv-converter/receipts';
import { UnresolvedLineItemsError, submitReceipt } from './submitReceipt.js';
import { updateLineItemSplits } from './lineItemReview.js';
import { seedBasicReceipt } from './testing/fixtures.js';

describe('submitReceipt', () => {
    let prisma: PrismaClient;
    let cleanup: () => void;
    let dir: string;

    afterEach(() => {
        cleanup();
        rmSync(dir, { recursive: true, force: true });
    });

    it('rejects a receipt with unreviewed line items', async () => {
        ({ prisma, cleanup } = createTestDb());
        dir = mkdtempSync(join(tmpdir(), 'submit-test-'));
        const seeded = await seedBasicReceipt(prisma);

        await expect(submitReceipt(prisma, seeded.receiptId)).rejects.toThrow(UnresolvedLineItemsError);
    });

    it('submits a fully-reviewed receipt: sets SUBMITTED, seeds ItemSplitDefault, returns the aggregate', async () => {
        ({ prisma, cleanup } = createTestDb());
        dir = mkdtempSync(join(tmpdir(), 'submit-test-'));
        const seeded = await seedBasicReceipt(prisma);

        await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 100, Patrice: 0 } });
        await updateLineItemSplits(prisma, seeded.lineItemIds[1], { splits: { Brian: 0, Patrice: 100 } });

        const auditDir = join(dir, 'audits');
        const result = await submitReceipt(prisma, seeded.receiptId, { auditDir });

        expect(result.aggregate).toEqual({ Brian: 50, Patrice: 50 });
        expect(existsSync(result.auditPath)).toBe(true);

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.status).toBe(ReceiptStatus.SUBMITTED);
        expect(receipt.submittedAt).not.toBeNull();

        const defaults = await prisma.itemSplitDefault.findMany({ where: { itemId: seeded.itemIds[0] } });
        expect(defaults.find((d) => d.participantId === seeded.brianId)?.percent).toBe(100);
        expect(defaults.find((d) => d.participantId === seeded.patriceId)?.percent).toBe(0);
    });

    it('resubmitting an already-SUBMITTED receipt updates its live manifest entry and ItemSplitDefaults in place, without duplicating', async () => {
        ({ prisma, cleanup } = createTestDb());
        dir = mkdtempSync(join(tmpdir(), 'submit-test-'));
        const seeded = await seedBasicReceipt(prisma);
        const auditDir = join(dir, 'audits');

        await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 50, Patrice: 50 } });
        await updateLineItemSplits(prisma, seeded.lineItemIds[1], { splits: { Brian: 50, Patrice: 50 } });
        const firstResult = await submitReceipt(prisma, seeded.receiptId, { auditDir });
        expect(firstResult.aggregate).toEqual({ Brian: 50, Patrice: 50 });

        // Go back and correct the split, then resubmit — as the review UI now allows.
        await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 80, Patrice: 20 } });
        const secondResult = await submitReceipt(prisma, seeded.receiptId, { auditDir });
        expect(secondResult.aggregate).toEqual({ Brian: 65, Patrice: 35 });

        // No separate manifest artifact to go stale — listManifestEntries derives
        // live from Receipt/LineItem, so there's structurally no way to get a
        // stale or duplicate entry: only the current splits are ever reflected.
        const entries = await listManifestEntries(prisma);
        expect(entries).toHaveLength(1);
        expect(entries[0].receiptId).toBe(seeded.receiptId);
        expect(entries[0].percentages).toEqual({ Brian: 65, Patrice: 35 });

        const defaults = await prisma.itemSplitDefault.findMany({ where: { itemId: seeded.itemIds[0] } });
        expect(defaults.find((d) => d.participantId === seeded.brianId)?.percent).toBe(80);
        expect(defaults.find((d) => d.participantId === seeded.patriceId)?.percent).toBe(20);

        const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: seeded.receiptId } });
        expect(receipt.status).toBe(ReceiptStatus.SUBMITTED);
    });
});
