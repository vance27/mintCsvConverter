import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { E2E_DB_PATH } from './dbPath.js';

const PORT = 3199;
// e2e/ -> receipt-review -> packages -> repo root.
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export default defineConfig({
    testDir: '.',
    fullyParallel: false,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'on-first-retry',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        // Production mode (build once, one process serves API + static client)
        // rather than juggling Vite's dev proxy across two ports — simpler and
        // closer to what actually ships. Never reused across runs: this must
        // always be a fresh server bound to the isolated e2e DB below, never an
        // already-running dev server pointed at the real one.
        // The migrateDb.ts step runs (and completes) before the server starts,
        // rather than via Playwright's globalSetup hook — see migrateDb.ts for
        // why that ordering can't be trusted to Playwright itself.
        command:
            'nx run @mint-csv-converter/receipt-review:build && node --import tsx packages/receipt-review/e2e/migrateDb.ts && node --import tsx packages/receipt-review/src/server/index.ts',
        cwd: REPO_ROOT,
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        // No GOOGLE_OAUTH_* here, deliberately — the suite never clicks "Run
        // sync" or "Reauthorize" (those stay covered by app.spec.ts's
        // fake-injected integration tests), so the server needs none of that to
        // run cleanly, keeping this suite secret-free and CI-safe. SPREADSHEET_ID
        // is explicitly blanked (not just omitted) because Nx auto-loads the
        // repo root .env into every task's process.env, which `env` here merges
        // with rather than replaces — without this override the Sheet tab would
        // render whatever real spreadsheet a developer's local .env points at.
        env: { DATABASE_URL: `file:${E2E_DB_PATH}`, RECEIPT_REVIEW_API_PORT: String(PORT), SPREADSHEET_ID: '' },
    },
});
