import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
// Deep-imported since it's a test-only helper, not part of @mint-csv-converter/receipts'
// public index.ts — same precedent as packages/receipt-review's own app.spec.ts.
import { migrateDbAt } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import { E2E_DB_PATH } from './dbPath.js';

/**
 * Run directly (via `tsx`) as a prefix step in playwright.config.ts's
 * webServer.command, NOT wired up as Playwright's `globalSetup` — Playwright
 * 1.62 starts config.webServer (and waits for it to become reachable) as part
 * of its "plugin setup" tasks, which run *before* the `globalSetup` file list.
 * A `globalSetup.ts` here would run only after the server had already crashed
 * trying to query a not-yet-migrated DB (or worse, after it had already
 * started successfully against a stale DB, wiping the file out from under a
 * live process). Doing the wipe-and-migrate as an actual prior step in the
 * shell command is the only ordering Playwright guarantees.
 */
if (existsSync(E2E_DB_PATH)) {
    rmSync(E2E_DB_PATH);
}
mkdirSync(dirname(E2E_DB_PATH), { recursive: true });
migrateDbAt(E2E_DB_PATH);
