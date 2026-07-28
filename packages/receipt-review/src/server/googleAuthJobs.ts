import { SingleSlotJob, type JobState } from './singleSlotJob.js';

export type AuthJobState = JobState<void>;

export interface GoogleAuthJobsDeps {
    runAuthorizeFlow: () => Promise<void>;
    hasSavedCredentials: () => boolean;
}

/**
 * Single-slot job — only one reauthorize flow makes sense at a time, same
 * reasoning as SyncRunJobs. runAuthorizeFlow opens a real browser window on
 * the machine running this server, correct for this single-user,
 * localhost-only tool.
 */
export class GoogleAuthJobs {
    private readonly slot = new SingleSlotJob<void>();

    constructor(private readonly deps: GoogleAuthJobsDeps) {}

    start(): void {
        this.slot.start(() => this.deps.runAuthorizeFlow());
    }

    get(): AuthJobState | null {
        return this.slot.get();
    }

    isConnected(): boolean {
        return this.deps.hasSavedCredentials();
    }
}
