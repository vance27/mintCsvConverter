import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticate } from '@google-cloud/local-auth';
import { saveCredentials, defaultTokenPath } from './googleAuth.js';

// Scopes: the Sheets API scope this package writes with, plus the Apps
// Script API scope needed to call finalizeAddedRows via scripts.run.
// Confirm this list against your deployed script's actual manifest
// (Project Settings > "Show appsscript.json manifest file" > oauthScopes)
// per CLASP_SETUP.md#9-one-time-setup-for-the-sync-api — adjust here if it
// doesn't match.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.projects'];

/**
 * One-time interactive OAuth consent: opens a browser, runs a brief local
 * server to catch the redirect, and saves the resulting token for
 * SheetsClient to reuse on every future sync run. Callable from a CLI
 * script (see scripts/authorize.ts) or from a local server (see
 * packages/receipt-review's reauthorize flow) — both run on the same
 * machine as the browser that needs to complete the consent screen.
 */
export async function runAuthorizeFlow(
    clientId: string,
    clientSecret: string,
    tokenPath: string = defaultTokenPath(),
): Promise<void> {
    // @google-cloud/local-auth only accepts a keyfilePath, not credentials
    // directly — write one to a throwaway temp dir for the duration of this
    // one-time interactive flow rather than requiring a JSON file on disk.
    const tempDir = mkdtempSync(join(tmpdir(), 'mint-csv-converter-oauth-'));
    const keyfilePath = join(tempDir, 'client_secret.json');
    try {
        writeFileSync(
            keyfilePath,
            JSON.stringify({
                installed: { client_id: clientId, client_secret: clientSecret, redirect_uris: ['http://localhost'] },
            }),
        );
        const client = await authenticate({ keyfilePath, scopes: SCOPES });
        saveCredentials(client.credentials, tokenPath);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
