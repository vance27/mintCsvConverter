import type { SyncRunResult } from './syncRun.js';
import { SingleSlotJob, type JobState } from './singleSlotJob.js';

export type SyncRunJobState = JobState<SyncRunResult>;

export interface SyncRunJobsDeps {
    run: () => Promise<SyncRunResult>;
}

/**
 * Single-slot job — only one "Run sync" makes sense at a time, same
 * reasoning as GoogleAuthJobs. Live progress while it runs; the durable
 * record is the persisted CsvSyncRun (see syncRun.ts), queried separately
 * via listSyncRuns for history.
 */
export class SyncRunJobs {
    private readonly slot = new SingleSlotJob<SyncRunResult>();

    constructor(private readonly deps: SyncRunJobsDeps) {}

    start(): void {
        this.slot.start(() => this.deps.run());
    }

    get(): SyncRunJobState | null {
        return this.slot.get();
    }
}
