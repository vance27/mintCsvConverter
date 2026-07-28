import { runAuthorizeFlow } from '../authorizeFlow.js';
import { defaultTokenPath } from '../googleAuth.js';

// One-time interactive OAuth consent: opens your browser, runs a brief
// local server to catch the redirect, and saves the resulting token for
// SheetsClient to reuse on every future sync run. Run this once per
// machine (or whenever the saved token is revoked/deleted):
//
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
//     pnpm --filter @mint-csv-converter/automation exec tsx src/scripts/authorize.ts
//
// Also callable from packages/receipt-review's web UI (see its
// reauthorize flow) via the same runAuthorizeFlow this script wraps.
async function main(): Promise<void> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error(
            'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (from the OAuth Desktop app client)',
        );
    }

    await runAuthorizeFlow(clientId, clientSecret);
    console.log(`Saved Google OAuth credentials to ${defaultTokenPath()}`);
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
