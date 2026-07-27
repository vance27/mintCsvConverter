import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import {
  defaultSheetsClient,
  hasSavedCredentials as automationHasSavedCredentials,
  runAuthorizeFlow as automationRunAuthorizeFlow,
  type SheetsClient,
} from '@mint-csv-converter/automation';
import {
  aggregateSplits,
  renderPdfPages,
  listPayerExclusionRules,
  createPayerExclusionRule,
  deletePayerExclusionRule,
  createPayerExclusionRuleSchema,
  listVariableSplitRules,
  createVariableSplitRule,
  deleteVariableSplitRule,
  createVariableSplitRuleSchema,
  listCsvImportProfiles,
  createCsvImportProfile,
  deleteCsvImportProfile,
  createCsvImportProfileSchema,
  type AggregateLine,
  type PrismaClient,
  type VisionChatClient,
} from '@mint-csv-converter/receipts';
import { getReceiptDetail, listReceipts } from './receiptQueries.js';
import { listImportedTransactions, toTransactionSummary } from './transactionQueries.js';
import { SplitsSumError, updateLineItemSplits, updateLineItemSplitsSchema } from './lineItemReview.js';
import { TransactionSyncedError, updateImportedTransaction, updateImportedTransactionSchema } from './transactionMutations.js';
import { UnresolvedLineItemsError, submitReceipt, type SubmitReceiptOptions } from './submitReceipt.js';
import { previewCsvImport } from './csvPreview.js';
import { UploadJobs } from './uploadJobs.js';
import { ImportJobs } from './importJobs.js';
import { buildSyncOverview, runSyncOverview, listSyncRuns } from './syncRun.js';
import { SyncRunJobs } from './syncRunJobs.js';
import { GoogleAuthJobs } from './googleAuthJobs.js';
import { generateAuditHtml, writeAuditHtml, defaultAuditDir } from './auditReport.js';

export interface AppDeps {
  prisma: PrismaClient;
  client: VisionChatClient;
  /** Overrides for tests only — default to the real ~/.config/mint-csv-converter/ locations. */
  receiptsBaseDir?: string;
  submitOptions?: SubmitReceiptOptions;
  /** Override for tests only — defaults to automation's real defaultSheetsClient (reads env vars + the saved OAuth token). */
  buildSheetsClient?: () => Pick<SheetsClient, 'addTransactionsForPeriod'>;
  /** Overrides for tests only — default to automation's real runAuthorizeFlow/hasSavedCredentials. */
  runAuthorizeFlow?: () => Promise<void>;
  hasSavedCredentials?: () => boolean;
}

async function defaultRunAuthorizeFlow(): Promise<void> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (from the OAuth Desktop app client)');
  }
  await automationRunAuthorizeFlow(clientId, clientSecret);
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
  const googleAuthJobs = new GoogleAuthJobs({
    runAuthorizeFlow: deps.runAuthorizeFlow ?? defaultRunAuthorizeFlow,
    hasSavedCredentials: deps.hasSavedCredentials ?? automationHasSavedCredentials,
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

    // Parses a raw CSV (no commitment) and tries to auto-detect a saved
    // CsvImportProfile — the configurator UI's first step. Synchronous:
    // this is just CSV parsing, not the slow VLM work /api/uploads kicks
    // off, so no job-polling needed.
    .post('/api/csv-import-preview', async (c) => {
      const body = await c.req.parseBody();
      const file = body['file'];
      if (!(file instanceof File)) {
        throw new HTTPException(400, { message: 'No file uploaded' });
      }
      const dir = mkdtempSync(join(tmpdir(), 'csv-preview-'));
      const csvPath = join(dir, file.name);
      writeFileSync(csvPath, new Uint8Array(await file.arrayBuffer()));
      const preview = await previewCsvImport(deps.prisma, csvPath);
      return c.json(preview);
    })

    .get('/api/csv-import-profiles', async (c) => c.json(await listCsvImportProfiles(deps.prisma)))

    .post('/api/csv-import-profiles', zValidator('json', createCsvImportProfileSchema), async (c) => {
      const profile = await createCsvImportProfile(deps.prisma, c.req.valid('json'));
      return c.json(profile);
    })

    .delete('/api/csv-import-profiles/:id', async (c) => {
      await deleteCsvImportProfile(deps.prisma, parseIntParam(c.req.param('id')));
      return c.json({ ok: true });
    })

    // CSV import — stages ImportedTransaction rows only, never touches
    // Google Sheets (see /api/sync-runs for that, a separate, explicit
    // step). Requires a profileId resolved via the preview step above
    // (either an auto-detected match or one just saved from the
    // configurator) so every import's column mapping is explicit.
    .post('/api/imports', async (c) => {
      const body = await c.req.parseBody({ all: true });
      const files = ([] as File[]).concat((body['files'] ?? []) as File | File[]);
      if (files.length === 0) {
        throw new HTTPException(400, { message: 'No files uploaded' });
      }
      const payer = typeof body['payer'] === 'string' ? body['payer'] : 'Brian';
      const profileId = Number(body['profileId']);
      if (!Number.isInteger(profileId)) {
        throw new HTTPException(400, { message: 'Missing or invalid profileId' });
      }

      const jobIds = await Promise.all(
        files.map(async (file) => {
          const buffer = new Uint8Array(await file.arrayBuffer());
          return importJobs.start(buffer, file.name, { payer, profileId });
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

    // Edits a staged transaction's split type and/or soft-deletes it —
    // blocked once syncedAt is set (see transactionMutations.ts).
    .patch('/api/transactions/:id', zValidator('json', updateImportedTransactionSchema), async (c) => {
      const id = parseIntParam(c.req.param('id'));
      const body = c.req.valid('json');
      try {
        await updateImportedTransaction(deps.prisma, id, body);
      } catch (error) {
        if (error instanceof TransactionSyncedError) {
          throw new HTTPException(400, { message: error.message });
        }
        throw error;
      }
      const transaction = await deps.prisma.importedTransaction.findUniqueOrThrow({ where: { id } });
      const receipts = await listReceipts(deps.prisma);
      return c.json(toTransactionSummary(transaction, receipts));
    })

    // DB-backed replacement for CsvConverterFactory's hardcoded
    // defaultPersonalExclusions/defaultSplitRulesDict.VARIABLE — see
    // automation's loadDbBackedFactory, which both this package's
    // importJobs.ts and automation's sync.ts read these same rows through.
    .get('/api/exclusion-rules', async (c) => c.json(await listPayerExclusionRules(deps.prisma)))

    .post('/api/exclusion-rules', zValidator('json', createPayerExclusionRuleSchema), async (c) => {
      const rule = await createPayerExclusionRule(deps.prisma, c.req.valid('json'));
      return c.json(rule);
    })

    .delete('/api/exclusion-rules/:id', async (c) => {
      await deletePayerExclusionRule(deps.prisma, parseIntParam(c.req.param('id')));
      return c.json({ ok: true });
    })

    .get('/api/variable-split-rules', async (c) => c.json(await listVariableSplitRules(deps.prisma)))

    .post('/api/variable-split-rules', zValidator('json', createVariableSplitRuleSchema), async (c) => {
      const rule = await createVariableSplitRule(deps.prisma, c.req.valid('json'));
      return c.json(rule);
    })

    .delete('/api/variable-split-rules/:id', async (c) => {
      await deleteVariableSplitRule(deps.prisma, parseIntParam(c.req.param('id')));
      return c.json({ ok: true });
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

    .get('/api/google-auth/status', (c) => c.json({ connected: googleAuthJobs.isConnected(), job: googleAuthJobs.get() }))

    .post('/api/google-auth/reauthorize', (c) => {
      googleAuthJobs.start();
      return c.json({ started: true });
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
