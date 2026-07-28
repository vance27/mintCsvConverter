import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
// Deep-imported since it's a test-only helper, not part of @mint-csv-converter/receipts'
// public index.ts — same precedent as packages/receipt-review's own app.spec.ts.
import { migrateDbAt } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import { E2E_DB_PATH } from './dbPath.js';

/** Runs once before the whole e2e suite: a fresh, fully-migrated DB, never the real one. */
export default function globalSetup(): void {
    if (existsSync(E2E_DB_PATH)) {
        rmSync(E2E_DB_PATH);
    }
    mkdirSync(dirname(E2E_DB_PATH), { recursive: true });
    migrateDbAt(E2E_DB_PATH);
}
