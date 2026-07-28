import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTTPException } from 'hono/http-exception';
import {
    queueReceiptForIngest,
    runIngestExtraction,
    type PrismaClient,
    type VisionChatClient,
} from '@mint-csv-converter/receipts';
import { canRetry } from '@mint-csv-converter/receipts/receiptStateMachine';

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
    /** The receipt currently being extracted and the controller that can abort its live VLM request — null whenever nothing is in flight. */
    private current: { receiptId: number; controller: AbortController } | null = null;

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

    async enqueue(
        fileBuffer: Uint8Array,
        filename: string,
        options: { store: string; payer: string },
    ): Promise<{ receiptId: number }> {
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

    /** Resets an already-FAILED or CANCELLED receipt back to QUEUED and wakes the worker — no re-upload needed. */
    async retry(receiptId: number): Promise<void> {
        const { count } = await this.deps.prisma.receipt.updateMany({
            where: { id: receiptId, status: { in: ['FAILED', 'CANCELLED'] } },
            data: { status: 'QUEUED', extractionError: null },
        });
        if (count === 0) {
            const receipt = await this.deps.prisma.receipt.findUnique({ where: { id: receiptId } });
            if (!receipt) {
                throw new HTTPException(404, { message: `Receipt ${receiptId} not found` });
            }
            if (!canRetry(receipt.status)) {
                throw new HTTPException(400, {
                    message: `Receipt ${receiptId} isn't FAILED or CANCELLED (status: ${receipt.status}) — can't retry`,
                });
            }
        }
        this.wake();
    }

    /** Call once at server startup: a row stuck EXTRACTING means a prior process died mid-extraction — requeue it so drain() retries automatically. */
    async recoverStuckRows(): Promise<void> {
        const { count } = await this.deps.prisma.receipt.updateMany({
            where: { status: 'EXTRACTING' },
            data: { status: 'QUEUED' },
        });
        if (count > 0) {
            console.log(`[upload] recovered ${count} row(s) stuck EXTRACTING from a prior process`);
        }
        this.wake();
    }

    /**
     * Stops a QUEUED or EXTRACTING receipt. A QUEUED row has no live request
     * yet, so it's just flipped straight to CANCELLED, which drops it out of
     * drain()'s next `findFirst`. An EXTRACTING row's VLM call is genuinely
     * in flight — aborting its AbortController actually tears down the live
     * fetch to Ollama (see ollamaClient.ts's streaming reassembly, the one
     * place cancellation is real rather than cosmetic), freeing the model's
     * single processing slot immediately instead of leaving an orphaned
     * request to finish or error out on its own in the background.
     */
    async cancel(receiptId: number): Promise<void> {
        if (this.current?.receiptId === receiptId) {
            console.log(`[upload:${receiptId}] cancelling in-flight extraction`);
            this.current.controller.abort();
            return;
        }
        const { count } = await this.deps.prisma.receipt.updateMany({
            where: { id: receiptId, status: 'QUEUED' },
            data: { status: 'CANCELLED' },
        });
        if (count > 0) {
            console.log(`[upload:${receiptId}] cancelled while queued`);
        }
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
                next = await this.deps.prisma.receipt.findFirst({
                    where: { status: 'QUEUED' },
                    orderBy: { createdAt: 'asc' },
                });
            } catch (error) {
                console.error(
                    '[upload] failed to check the queue — stopping until the next upload:',
                    error instanceof Error ? error.message : error,
                );
                this.draining = false;
                return;
            }
            if (!next) {
                this.draining = false;
                return;
            }
            console.log(`[upload:${next.id}] starting extraction`);
            const controller = new AbortController();
            this.current = { receiptId: next.id, controller };
            try {
                const result = await runIngestExtraction(next.id, this.deps, { signal: controller.signal });
                console.log(`[upload:${next.id}] done — reconciled=${result.reconciled} attempts=${result.attempts}`);
                consecutiveFailures = 0;
            } catch (error) {
                if (controller.signal.aborted) {
                    // A deliberate cancel: runIngestExtraction's own catch already
                    // marked the row FAILED with whatever raw abort error text the
                    // fetch threw — move it to CANCELLED with no extractionError
                    // (that field is a FAILED-only concept now), and don't count
                    // this toward the consecutive-failure circuit breaker (it
                    // isn't a sign anything is actually broken).
                    await this.deps.prisma.receipt
                        .update({ where: { id: next.id }, data: { status: 'CANCELLED', extractionError: null } })
                        .catch(() => {
                            // Best-effort, same reasoning as runIngestExtraction's own FAILED-write catch.
                        });
                    console.log(`[upload:${next.id}] cancelled`);
                } else {
                    console.error(`[upload:${next.id}] failed:`, error instanceof Error ? error.message : error);
                    consecutiveFailures++;
                    if (consecutiveFailures >= 3) {
                        console.error(
                            `[upload] ${consecutiveFailures} consecutive failures — stopping until the next upload to avoid a tight retry loop.`,
                        );
                        this.draining = false;
                        return;
                    }
                }
            } finally {
                this.current = null;
            }
        }
    }
}
