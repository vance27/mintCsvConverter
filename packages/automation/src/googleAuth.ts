import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { OAuth2Client, type Credentials } from 'google-auth-library';

/** Where the OAuth token captured by scripts/authorize.ts is stored (mirrors syncState.ts's convention). */
export function defaultTokenPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  return `${home}/.config/mint-csv-converter/google-token.json`;
}

/**
 * Builds an authenticated OAuth2Client from a saved token file, throwing a
 * clear error rather than prompting interactively if none exists yet — the
 * one-time interactive consent flow lives in scripts/authorize.ts.
 *
 * @param clientId - OAuth client ID (from GOOGLE_OAUTH_CLIENT_ID; see CLASP_SETUP.md).
 * @param clientSecret - OAuth client secret (from GOOGLE_OAUTH_CLIENT_SECRET).
 * @param tokenPath - Where to read the saved token from (default: defaultTokenPath()).
 * @returns An OAuth2Client with the saved credentials applied.
 * @throws If no saved token exists.
 */
export function loadSavedCredentialsOrThrow(clientId: string, clientSecret: string, tokenPath: string = defaultTokenPath()): OAuth2Client {
  if (!existsSync(tokenPath)) {
    throw new Error(
      `No saved Google OAuth token at ${tokenPath} — run the authorize script first: ` +
        "pnpm --filter @mint-csv-converter/automation exec tsx src/scripts/authorize.ts (see this package's README).",
    );
  }

  const credentials = JSON.parse(readFileSync(tokenPath, 'utf-8')) as Credentials;
  const client = new OAuth2Client({ clientId, clientSecret });
  client.setCredentials(credentials);
  return client;
}

/** Persists OAuth credentials (from scripts/authorize.ts's interactive flow) for later reuse. */
export function saveCredentials(credentials: Credentials, tokenPath: string = defaultTokenPath()): void {
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify(credentials, null, 2) + '\n', 'utf-8');
}
