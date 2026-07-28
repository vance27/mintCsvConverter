import { describe, it, expect, afterEach, vi } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import { CsvSyncRunStatus, type PrismaClient } from '@mint-csv-converter/receipts';
import type { AddTransactionsRequest } from '@mint-csv-converter/automation';
import { runSyncOverview } from './syncRun.js';
import { updateLineItemSplits } from './lineItemReview.js';
import { submitReceipt } from './submitReceipt.js';
import { seedBasicReceipt } from './testing/fixtures.js';

describe('runSyncOverview manifest matching', () => {
    let prisma: PrismaClient;
    let cleanup: () => void;

    afterEach(() => {
        cleanup();
    });

    it('fills rowPercentages for a Variably transaction matching a submitted receipt', async () => {
        ({ prisma, cleanup } = createTestDb());
        const seeded = await seedBasicReceipt(prisma);
        await updateLineItemSplits(prisma, seeded.lineItemIds[0], { splits: { Brian: 70, Patrice: 30 } });
        await updateLineItemSplits(prisma, seeded.lineItemIds[1], { splits: { Brian: 70, Patrice: 30 } });
        await submitReceipt(prisma, seeded.receiptId);

        await prisma.importedTransaction.create({
            data: {
                payer: 'Brian',
                date: '07/01/2026',
                description: 'Costco Wholesale',
                amount: 20,
                splitType: 'Variably',
            },
        });

        const addTransactionsForPeriod = vi.fn(async (_request: AddTransactionsRequest) => ({
            sheetName: 'x',
            rowsAdded: 1,
        }));
        const result = await runSyncOverview({ prisma, buildSheetsClient: () => ({ addTransactionsForPeriod }) });

        expect(result.status).toBe(CsvSyncRunStatus.DONE);
        expect(addTransactionsForPeriod).toHaveBeenCalledTimes(1);
        const request = addTransactionsForPeriod.mock.calls[0][0] as { rowPercentages: unknown[] };
        expect(request.rowPercentages).toEqual([{ Brian: 70, Patrice: 30 }]);
    });

    it('leaves rowPercentages null for a Variably transaction with no submitted-receipt match', async () => {
        ({ prisma, cleanup } = createTestDb());
        await prisma.importedTransaction.create({
            data: {
                payer: 'Brian',
                date: '07/01/2026',
                description: 'Costco Wholesale',
                amount: 20,
                splitType: 'Variably',
            },
        });

        const addTransactionsForPeriod = vi.fn(async (_request: AddTransactionsRequest) => ({
            sheetName: 'x',
            rowsAdded: 1,
        }));
        const result = await runSyncOverview({ prisma, buildSheetsClient: () => ({ addTransactionsForPeriod }) });

        expect(result.status).toBe(CsvSyncRunStatus.DONE);
        const request = addTransactionsForPeriod.mock.calls[0][0] as { rowPercentages: unknown[] };
        expect(request.rowPercentages).toEqual([null]);
    });
});
