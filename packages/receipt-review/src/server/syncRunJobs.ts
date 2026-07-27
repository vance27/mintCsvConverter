import type { SyncRunResult } from './syncRun.js';

export type SyncRunJobState = { status: 'pending' } | { status: 'done'; result: SyncRunResult } | { status: 'error'; message: string };

export interface SyncRunJobsDeps {
  run: () => Promise<SyncRunResult>;
}

/**
 * Single-slot job (no map) — only one "Run sync" makes sense at a time,
 * same reasoning as GoogleAuthJobs. Live progress while it runs; the
 * durable record is the persisted CsvSyncRun (see syncRun.ts), queried
 * separately via listSyncRuns for history.
 */
export class SyncRunJobs {
  private current: SyncRunJobState | null = null;

  constructor(private readonly deps: SyncRunJobsDeps) {}

  start(): void {
    if (this.current?.status === 'pending') {
      return;
    }
    this.current = { status: 'pending' };
    this.deps
      .run()
      .then((result) => {
        this.current = { status: 'done', result };
      })
      .catch((error: unknown) => {
        this.current = { status: 'error', message: error instanceof Error ? error.message : String(error) };
      });
  }

  get(): SyncRunJobState | null {
    return this.current;
  }
}
