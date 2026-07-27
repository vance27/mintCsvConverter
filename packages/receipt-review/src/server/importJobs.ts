import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CsvConverterFactory, ImportFileToLines } from '@mint-csv-converter/core';
import type { PrismaClient } from '@mint-csv-converter/receipts';

export interface ImportResult {
  importedCount: number;
  skippedDuplicateCount: number;
  excludedCount: number;
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

  start(csvBuffer: Uint8Array, filename: string, options: { payer: string }): string {
    const jobId = randomUUID();
    this.jobs.set(jobId, { status: 'pending' });

    const dir = mkdtempSync(join(tmpdir(), 'csv-import-'));
    const csvPath = join(dir, filename);
    writeFileSync(csvPath, csvBuffer);

    importCsv(this.deps.prisma, csvPath, options.payer)
      .then((result) => this.jobs.set(jobId, { status: 'done', result }))
      .catch((error: unknown) => {
        this.jobs.set(jobId, { status: 'error', message: error instanceof Error ? error.message : String(error) });
      });

    return jobId;
  }

  get(jobId: string): ImportJobState | undefined {
    return this.jobs.get(jobId);
  }
}

async function importCsv(prisma: PrismaClient, csvPath: string, payer: string): Promise<ImportResult> {
  const factory = new CsvConverterFactory();
  const rows = new ImportFileToLines(csvPath).getResults().slice(1); // skip header

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

  if (toInsert.length > 0) {
    await prisma.importedTransaction.createMany({ data: toInsert });
  }

  return { importedCount: toInsert.length, skippedDuplicateCount: candidates.length - toInsert.length, excludedCount };
}

function transactionKey(date: string, description: string, amount: number): string {
  return `${date}|${description}|${amount}`;
}
