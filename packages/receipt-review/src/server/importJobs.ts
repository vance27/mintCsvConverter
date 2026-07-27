import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImportFileToLines, type CsvColumnMapping } from '@mint-csv-converter/core';
import { loadDbBackedFactory, toIsoDate } from '@mint-csv-converter/automation';
import { createImportBatch, type PrismaClient } from '@mint-csv-converter/receipts';

export interface ImportResult {
  importedCount: number;
  skippedDuplicateCount: number;
  excludedCount: number;
  importBatchId: number | null;
}

export type ImportJobState = { status: 'pending' } | { status: 'done'; result: ImportResult } | { status: 'error'; message: string };

export interface ImportJobsDeps {
  prisma: PrismaClient;
}

/**
 * Tracks in-flight CSV imports in memory — same shape as UploadJobs
 * (uploadJobs.ts). Importing only ever stages ImportedTransaction rows; it
 * never touches Google Sheets (see syncRun.ts for that, a separate,
 * explicitly-triggered step).
 */
export class ImportJobs {
  private readonly jobs = new Map<string, ImportJobState>();

  constructor(private readonly deps: ImportJobsDeps) {}

  start(csvBuffer: Uint8Array, filename: string, options: { payer: string; profileId: number }): string {
    const jobId = randomUUID();
    this.jobs.set(jobId, { status: 'pending' });

    const dir = mkdtempSync(join(tmpdir(), 'csv-import-'));
    const csvPath = join(dir, filename);
    writeFileSync(csvPath, csvBuffer);

    console.log(`[import:${jobId}] starting ${filename}`);
    importCsv(this.deps.prisma, csvPath, filename, options.payer, options.profileId)
      .then((result) => {
        console.log(
          `[import:${jobId}] done — imported=${result.importedCount} skipped=${result.skippedDuplicateCount} excluded=${result.excludedCount}`,
        );
        this.jobs.set(jobId, { status: 'done', result });
      })
      .catch((error: unknown) => {
        console.error(`[import:${jobId}] failed:`, error instanceof Error ? error.message : error);
        this.jobs.set(jobId, { status: 'error', message: error instanceof Error ? error.message : String(error) });
      });

    return jobId;
  }

  get(jobId: string): ImportJobState | undefined {
    return this.jobs.get(jobId);
  }
}

async function importCsv(prisma: PrismaClient, csvPath: string, filename: string, payer: string, profileId: number): Promise<ImportResult> {
  const factory = await loadDbBackedFactory(prisma);
  const profile = await prisma.csvImportProfile.findUniqueOrThrow({ where: { id: profileId } });
  const mapping = JSON.parse(profile.columnMappingJson) as CsvColumnMapping;
  const rows = new ImportFileToLines(csvPath, mapping).getResults().slice(1); // skip header

  let excludedCount = 0;
  const candidates = rows.map((line) => {
    const [date, description, , amountStr] = line;
    const excluded = !factory.isValidLine(line, payer);
    const splitType = factory.isVariableSplit(line) ? 'Variably' : 'Equally';
    if (excluded) {
      excludedCount++;
    }
    return {
      payer,
      date,
      description,
      amount: Number.parseFloat(amountStr),
      splitType,
      excluded,
      exclusionReason: excluded ? 'Matches a personal-exclusion vendor entry' : null,
    };
  });

  // SQLite's Prisma driver doesn't support createMany's skipDuplicates, so
  // re-importing an overlapping export is instead made idempotent by
  // pre-checking against already-staged rows (a single query, fine at this
  // tool's scale) and also de-duping within this batch — a genuinely
  // repeated line in the same export would otherwise hit the
  // @@unique([payer, date, description, amount]) constraint directly.
  const existing = await prisma.importedTransaction.findMany({ where: { payer }, select: { date: true, description: true, amount: true } });
  const existingKeys = new Set(existing.map((t) => transactionKey(t.date, t.description, t.amount)));

  const seenInBatch = new Set<string>();
  const toInsert = candidates.filter((c) => {
    const key = transactionKey(c.date, c.description, c.amount);
    if (existingKeys.has(key) || seenInBatch.has(key)) {
      return false;
    }
    seenInBatch.add(key);
    return true;
  });

  // A data-less batch (empty/header-only CSV) would be meaningless in the
  // Review Transactions batch picker, so only create one when there's
  // something to date-range over.
  let importBatchId: number | null = null;
  if (candidates.length > 0) {
    const isoDates = candidates.map((c) => ({ raw: c.date, iso: toIsoDate(c.date) }));
    const minDate = isoDates.reduce((min, d) => (d.iso < min.iso ? d : min)).raw;
    const maxDate = isoDates.reduce((max, d) => (d.iso > max.iso ? d : max)).raw;
    const batch = await createImportBatch(prisma, {
      title: `${payer} — ${minDate}–${maxDate}`,
      payer,
      minDate,
      maxDate,
      sourceFilename: filename,
      csvImportProfileId: profileId,
      importedCount: toInsert.length,
      skippedDuplicateCount: candidates.length - toInsert.length,
      excludedCount,
    });
    importBatchId = batch.id;
  }

  if (toInsert.length > 0) {
    await prisma.importedTransaction.createMany({ data: toInsert.map((c) => ({ ...c, importBatchId })) });
  }

  return { importedCount: toInsert.length, skippedDuplicateCount: candidates.length - toInsert.length, excludedCount, importBatchId };
}

function transactionKey(date: string, description: string, amount: number): string {
  return `${date}|${description}|${amount}`;
}
