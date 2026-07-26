import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestReceipt, type IngestResult, type PrismaClient, type VisionChatClient } from '@mint-csv-converter/receipts';

export type JobState =
  | { status: 'pending' }
  | { status: 'done'; result: IngestResult }
  | { status: 'error'; message: string };

export interface UploadJobsDeps {
  prisma: PrismaClient;
  client: VisionChatClient;
  /** Override for tests only. */
  receiptsBaseDir?: string;
}

/**
 * Tracks in-flight receipt extraction in memory — no DB table. Extraction
 * takes ~130-170s with the default model, so uploads return a job id
 * immediately and the client polls; losing job state on a server restart is
 * harmless since ingestReceipt itself is idempotent by content hash.
 */
export class UploadJobs {
  private readonly jobs = new Map<string, JobState>();

  constructor(private readonly deps: UploadJobsDeps) {}

  start(fileBuffer: Uint8Array, filename: string, options: { store: string; payer: string }): string {
    const jobId = randomUUID();
    this.jobs.set(jobId, { status: 'pending' });

    const dir = mkdtempSync(join(tmpdir(), 'receipt-upload-'));
    const pdfPath = join(dir, filename);
    writeFileSync(pdfPath, fileBuffer);

    ingestReceipt(pdfPath, options, {
      prisma: this.deps.prisma,
      client: this.deps.client,
      receiptsBaseDir: this.deps.receiptsBaseDir,
    })
      .then((result) => this.jobs.set(jobId, { status: 'done', result }))
      .catch((error: unknown) => {
        this.jobs.set(jobId, { status: 'error', message: error instanceof Error ? error.message : String(error) });
      });

    return jobId;
  }

  get(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }
}
