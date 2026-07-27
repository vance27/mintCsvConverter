export type AuthJobState = { status: 'pending' } | { status: 'done' } | { status: 'error'; message: string };

export interface GoogleAuthJobsDeps {
  runAuthorizeFlow: () => Promise<void>;
  hasSavedCredentials: () => boolean;
}

/**
 * Single-slot job (no map) — only one reauthorize flow makes sense at a
 * time, same reasoning as SyncRunJobs. runAuthorizeFlow opens a real
 * browser window on the machine running this server, correct for this
 * single-user, localhost-only tool.
 */
export class GoogleAuthJobs {
  private current: AuthJobState | null = null;

  constructor(private readonly deps: GoogleAuthJobsDeps) {}

  start(): void {
    if (this.current?.status === 'pending') {
      return;
    }
    this.current = { status: 'pending' };
    this.deps
      .runAuthorizeFlow()
      .then(() => {
        this.current = { status: 'done' };
      })
      .catch((error: unknown) => {
        this.current = { status: 'error', message: error instanceof Error ? error.message : String(error) };
      });
  }

  get(): AuthJobState | null {
    return this.current;
  }

  isConnected(): boolean {
    return this.deps.hasSavedCredentials();
  }
}
