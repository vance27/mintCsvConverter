import { fileURLToPath } from 'node:url';

/**
 * A fixed (not per-run-random) path so playwright.config.ts's webServer.env
 * and migrateDb.ts can agree on it without a runtime side channel — both are
 * evaluated once at config-load time, before the server process is spawned.
 * Gitignored via the repo-wide `*.db` rule; recreated fresh by
 * migrateDb.ts on every e2e run, never the real
 * ~/.config/mint-csv-converter/receipts.db.
 */
export const E2E_DB_PATH = fileURLToPath(new URL('.tmp/e2e.db', import.meta.url));
