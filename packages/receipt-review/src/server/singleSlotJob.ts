export type JobState<TResult> =
    { status: 'pending' } | { status: 'done'; result: TResult } | { status: 'error'; message: string };

/**
 * One in-flight async job tracked in memory, no queueing — a second start()
 * while pending is a no-op. Shared core for GoogleAuthJobs/SyncRunJobs
 * (single instance per server) and ImportJobs (one fresh instance per jobId
 * in its own Map).
 */
export class SingleSlotJob<TResult> {
    private current: JobState<TResult> | null = null;

    start(fn: () => Promise<TResult>): void {
        if (this.current?.status === 'pending') {
            return;
        }
        this.current = { status: 'pending' };
        fn()
            .then((result) => {
                this.current = { status: 'done', result };
            })
            .catch((error: unknown) => {
                this.current = { status: 'error', message: error instanceof Error ? error.message : String(error) };
            });
    }

    get(): JobState<TResult> | null {
        return this.current;
    }
}
