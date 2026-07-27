import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queueReceiptForIngest, runIngestExtraction, type PrismaClient, type VisionChatClient } from '@mint-csv-converter/receipts';

export interface UploadQueueDeps {
  prisma: PrismaClient;
  client: VisionChatClient;
  /** Override for tests only. */
  receiptsBaseDir?: string;
}

/**
 * Drives receipt extraction one at a time, matching the underlying
 * llama-server's own `-np 1` (single concurrent request) setting explicitly
 * instead of relying on that as an incidental side effect. Queue position
 * and live status are derived entirely from Receipt.status/createdAt in the
 * DB (see receiptQueries.ts) — this class only owns the sequential worker
 * loop, it holds no state of its own that the app depends on for
 * correctness, so losing it on a restart is harmless (recoverStuckRows
 * picks back up any row a prior process died mid-extraction on).
 */
export class UploadQueue {
  private draining = false;
  private drainPromise: Promise<void> = Promise.resolve();

  constructor(private readonly deps: UploadQueueDeps) {}

  /**
   * Resolves once the queue has fully drained (no extraction in flight, no
   * more QUEUED rows) — useful for a graceful shutdown, and for tests that
   * need to know every last bit of background work (including drain()'s own
   * trailing "anything else queued?" check) has settled before tearing down
   * the database out from under it.
   */
  async waitUntilIdle(): Promise<void> {
    await this.drainPromise;
  }

  async enqueue(fileBuffer: Uint8Array, filename: string, options: { store: string; payer: string }): Promise<{ receiptId: number }> {
    const dir = mkdtempSync(join(tmpdir(), 'receipt-upload-'));
    try {
      const pdfPath = join(dir, filename);
      writeFileSync(pdfPath, fileBuffer);
      console.log(`[upload] queuing ${filename}`);
      const { receiptId } = await queueReceiptForIngest(pdfPath, options, this.deps);
      this.wake();
      return { receiptId };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Resets an already-FAILED receipt back to QUEUED and wakes the worker — no re-upload needed. */
  async retry(receiptId: number): Promise<void> {
    await this.deps.prisma.receipt.update({ where: { id: receiptId }, data: { status: 'QUEUED', extractionError: null } });
    this.wake();
  }

  /** Call once at server startup: a row stuck EXTRACTING means a prior process died mid-extraction — requeue it so drain() retries automatically. */
  async recoverStuckRows(): Promise<void> {
    const { count } = await this.deps.prisma.receipt.updateMany({ where: { status: 'EXTRACTING' }, data: { status: 'QUEUED' } });
    if (count > 0) {
      console.log(`[upload] recovered ${count} row(s) stuck EXTRACTING from a prior process`);
    }
    this.wake();
  }

  private wake(): void {
    if (this.draining) {
      return;
    }
    this.draining = true;
    this.drainPromise = this.drain();
  }

  private async drain(): Promise<void> {
    // runIngestExtraction always marks a failing row FAILED (removing it
    // from the QUEUED pool), so normally this loop never sees the same row
    // twice in a row. consecutiveFailures is a backstop for the case where
    // even that FAILED write can't land (e.g. the DB itself is unreachable)
    // — without it, a systemic failure would otherwise retry the same row
    // in a tight, unthrottled loop forever instead of giving up until the
    // next upload/retry wakes the queue again.
    let consecutiveFailures = 0;
    for (;;) {
      let next;
      try {
        next = await this.deps.prisma.receipt.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
      } catch (error) {
        console.error('[upload] failed to check the queue — stopping until the next upload:', error instanceof Error ? error.message : error);
        this.draining = false;
        return;
      }
      if (!next) {
        this.draining = false;
        return;
      }
      console.log(`[upload:${next.id}] starting extraction`);
      try {
        const result = await runIngestExtraction(next.id, this.deps);
        console.log(`[upload:${next.id}] done — reconciled=${result.reconciled} attempts=${result.attempts}`);
        consecutiveFailures = 0;
      } catch (error) {
        console.error(`[upload:${next.id}] failed:`, error instanceof Error ? error.message : error);
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          console.error(`[upload] ${consecutiveFailures} consecutive failures — stopping until the next upload to avoid a tight retry loop.`);
          this.draining = false;
          return;
        }
      }
    }
  }
}
