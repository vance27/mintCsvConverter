import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { defaultSheetsClient, type SheetsClient } from '@mint-csv-converter/automation';
import {
  aggregateSplits,
  renderPdfPages,
  type AggregateLine,
  type PrismaClient,
  type VisionChatClient,
} from '@mint-csv-converter/receipts';
import { getReceiptDetail, listReceipts } from './receiptQueries.js';
import { listImportedTransactions } from './transactionQueries.js';
import { SplitsSumError, updateLineItemSplits, updateLineItemSplitsSchema } from './lineItemReview.js';
import { UnresolvedLineItemsError, submitReceipt, type SubmitReceiptOptions } from './submitReceipt.js';
import { UploadJobs } from './uploadJobs.js';
import { ImportJobs } from './importJobs.js';
import { buildSyncOverview, runSyncOverview, listSyncRuns } from './syncRun.js';
import { SyncRunJobs } from './syncRunJobs.js';
import { generateAuditHtml, writeAuditHtml, defaultAuditDir } from './auditReport.js';

export interface AppDeps {
  prisma: PrismaClient;
  client: VisionChatClient;
  /** Overrides for tests only — default to the real ~/.config/mint-csv-converter/ locations. */
  receiptsBaseDir?: string;
  submitOptions?: SubmitReceiptOptions;
  /** Override for tests only — defaults to automation's real defaultSheetsClient (reads env vars + the saved OAuth token). */
  buildSheetsClient?: () => Pick<SheetsClient, 'addTransactionsForPeriod'>;
}

// Renders on demand and caches per-process only — each receipt is reviewed
// once, shortly after ingest, so cross-restart persistence isn't worth the
// added invalidation concern (see costco-receipt-importer.md's Phase 3 plan).
const pageImageCache = new Map<number, Buffer[]>();

function parseIntParam(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new HTTPException(400, { message: `Invalid id: ${value}` });
  }
  return parsed;
}

export function createApp(deps: AppDeps) {
  const uploadJobs = new UploadJobs({ prisma: deps.prisma, client: deps.client, receiptsBaseDir: deps.receiptsBaseDir });
  const importJobs = new ImportJobs({ prisma: deps.prisma });
  const syncRunJobs = new SyncRunJobs({
    run: () => runSyncOverview({ prisma: deps.prisma, buildSheetsClient: deps.buildSheetsClient ?? defaultSheetsClient }),
  });

  const app = new Hono()
    .get('/api/health', (c) => c.json({ ok: true }))

    .get('/api/receipts', async (c) => {
      const receipts = await listReceipts(deps.prisma);
      return c.json(receipts);
    })

    .get('/api/receipts/:id', async (c) => {
      const id = parseIntParam(c.req.param('id'));
      const detail = await getReceiptDetail(deps.prisma, id);
      if (!detail) {
        throw new HTTPException(404, { message: `Receipt ${id} not found` });
      }
      return c.json(detail);
    })

    .patch('/api/receipts/:id/line-items/:lineItemId', zValidator('json', updateLineItemSplitsSchema), async (c) => {
      const lineItemId = parseIntParam(c.req.param('lineItemId'));
      const body = c.req.valid('json');
      try {
        await updateLineItemSplits(deps.prisma, lineItemId, body);
      } catch (error) {
        if (error instanceof SplitsSumError) {
          throw new HTTPException(400, { message: error.message });
        }
        throw error;
      }
      const receiptId = (await deps.prisma.lineItem.findUniqueOrThrow({ where: { id: lineItemId } })).receiptId;
      const detail = await getReceiptDetail(deps.prisma, receiptId);
      if (!detail) {
        throw new HTTPException(404, { message: `Receipt ${receiptId} not found` });
      }
      return c.json(detail);
    })

    .post('/api/receipts/:id/submit', async (c) => {
      const id = parseIntParam(c.req.param('id'));
      try {
        const result = await submitReceipt(deps.prisma, id, deps.submitOptions);
        return c.json(result);
      } catch (error) {
        if (error instanceof UnresolvedLineItemsError) {
          throw new HTTPException(400, { message: error.message });
        }
        throw error;
      }
    })

    .post('/api/uploads', async (c) => {
      const body = await c.req.parseBody({ all: true });
      const files = ([] as File[]).concat((body['files'] ?? []) as File | File[]);
      if (files.length === 0) {
        throw new HTTPException(400, { message: 'No files uploaded' });
      }
      const store = typeof body['store'] === 'string' ? body['store'] : 'Costco';
      const payer = typeof body['payer'] === 'string' ? body['payer'] : 'Brian';

      const jobIds = await Promise.all(
        files.map(async (file) => {
          const buffer = new Uint8Array(await file.arrayBuffer());
          return uploadJobs.start(buffer, file.name, { store, payer });
        }),
      );
      return c.json({ jobIds });
    })

    .get('/api/uploads/:jobId', (c) => {
      const job = uploadJobs.get(c.req.param('jobId'));
      if (!job) {
        throw new HTTPException(404, { message: 'Unknown job id' });
      }
      return c.json(job);
    })

    // CSV import — stages ImportedTransaction rows only, never touches
    // Google Sheets (see /api/sync-runs for that, a separate, explicit step).
    .post('/api/imports', async (c) => {
      const body = await c.req.parseBody({ all: true });
      const files = ([] as File[]).concat((body['files'] ?? []) as File | File[]);
      if (files.length === 0) {
        throw new HTTPException(400, { message: 'No files uploaded' });
      }
      const payer = typeof body['payer'] === 'string' ? body['payer'] : 'Brian';

      const jobIds = await Promise.all(
        files.map(async (file) => {
          const buffer = new Uint8Array(await file.arrayBuffer());
          return importJobs.start(buffer, file.name, { payer });
        }),
      );
      return c.json({ jobIds });
    })

    .get('/api/imports/:jobId', (c) => {
      const job = importJobs.get(c.req.param('jobId'));
      if (!job) {
        throw new HTTPException(404, { message: 'Unknown job id' });
      }
      return c.json(job);
    })

    .get('/api/transactions', async (c) => {
      const transactions = await listImportedTransactions(deps.prisma);
      return c.json(transactions);
    })

    // A pure preview — zero Sheets calls — of what "Run sync" would do.
    .get('/api/sync-overview', async (c) => {
      const overview = await buildSyncOverview(deps.prisma);
      return c.json(overview);
    })

    // Kicks off the actual sync (single-flight — a no-op if one is already
    // running). Live progress via /api/sync-runs/current; the durable
    // record lands in the CsvSyncRun history (/api/sync-runs) once done.
    .post('/api/sync-runs', (c) => {
      syncRunJobs.start();
      return c.json({ started: true });
    })

    .get('/api/sync-runs/current', (c) => c.json(syncRunJobs.get()))

    .get('/api/sync-runs', async (c) => {
      const runs = await listSyncRuns(deps.prisma);
      return c.json(runs);
    })

    .get('/api/receipts/:id/source.pdf', async (c) => {
      const id = parseIntParam(c.req.param('id'));
      const receipt = await deps.prisma.receipt.findUnique({ where: { id } });
      if (!receipt) {
        throw new HTTPException(404, { message: `Receipt ${id} not found` });
      }
      const bytes = new Uint8Array(readFileSync(receipt.sourcePath));
      return c.body(bytes, 200, { 'Content-Type': 'application/pdf' });
    })

    .get('/api/receipts/:id/page-image/:pageIndex', async (c) => {
      const id = parseIntParam(c.req.param('id'));
      const pageIndex = parseIntParam(c.req.param('pageIndex'));
      let pages = pageImageCache.get(id);
      if (!pages) {
        const receipt = await deps.prisma.receipt.findUnique({ where: { id } });
        if (!receipt) {
          throw new HTTPException(404, { message: `Receipt ${id} not found` });
        }
        pages = await renderPdfPages(receipt.sourcePath);
        pageImageCache.set(id, pages);
      }
      const page = pages[pageIndex];
      if (!page) {
        throw new HTTPException(404, { message: `Page ${pageIndex} not found` });
      }
      return c.body(new Uint8Array(page), 200, { 'Content-Type': 'image/png' });
    })

    .get('/api/receipts/:id/audit.html', async (c) => {
      const id = parseIntParam(c.req.param('id'));
      const detail = await getReceiptDetail(deps.prisma, id);
      if (!detail) {
        throw new HTTPException(404, { message: `Receipt ${id} not found` });
      }
      const participantNames = [...new Set(detail.lineItems.flatMap((li) => Object.keys(li.splits)))];
      const aggregateLines: AggregateLine[] = detail.lineItems.map((li) => ({
        lineTotal: li.lineTotal,
        discountAmount: li.discountAmount,
        splits: li.splits,
      }));
      const aggregate = aggregateSplits(aggregateLines, participantNames);
      const html = generateAuditHtml({
        receiptId: detail.id,
        store: detail.store,
        payer: detail.payer,
        purchaseDate: detail.purchaseDate.slice(0, 10),
        total: detail.total,
        lineItems: detail.lineItems.map((li) => ({
          name: li.displayName ?? li.rawName,
          unitPrice: li.unitPrice,
          quantity: li.quantity,
          lineTotal: li.lineTotal,
          splits: li.splits,
        })),
        aggregate,
      });
      writeAuditHtml(id, html, deps.submitOptions?.auditDir ?? defaultAuditDir());
      return c.html(html);
    });

  // HTTPException defaults to a plain-text body; zValidator's own failure
  // path already returns JSON (see @hono/zod-validator), so this just makes
  // HTTPException match — every error response is JSON, uniformly.
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ message: err.message }, err.status);
    }
    throw err;
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
