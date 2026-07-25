import { authenticate } from '@google-cloud/local-auth';
import { saveCredentials, defaultTokenPath } from '../googleAuth.js';

// One-time interactive OAuth consent: opens your browser, runs a brief
// local server to catch the redirect, and saves the resulting token for
// SheetsClient to reuse on every future sync run. Run this once per
// machine (or whenever the saved token is revoked/deleted):
//
//   GOOGLE_OAUTH_CLIENT_SECRET_PATH=/path/to/client_secret.json \
//     pnpm --filter @mint-csv-converter/automation exec tsx src/scripts/authorize.ts
//
// Scopes: the Sheets API scope this package writes with, plus the Apps
// Script API scope needed to call finalizeAddedRows via scripts.run.
// Confirm this list against your deployed script's actual manifest
// (Project Settings > "Show appsscript.json manifest file" > oauthScopes)
// per CLASP_SETUP.md#9-one-time-setup-for-the-sync-api — adjust here if it
// doesn't match.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.projects'];

async function main(): Promise<void> {
  const clientSecretPath = process.env.GOOGLE_OAUTH_CLIENT_SECRET_PATH;
  if (!clientSecretPath) {
    throw new Error('Set GOOGLE_OAUTH_CLIENT_SECRET_PATH to the downloaded OAuth client secret JSON path');
  }

  const client = await authenticate({ keyfilePath: clientSecretPath, scopes: SCOPES });
  saveCredentials(client.credentials);
  console.log(`Saved Google OAuth credentials to ${defaultTokenPath()}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
