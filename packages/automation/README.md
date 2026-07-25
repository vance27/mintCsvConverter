# @mint-csv-converter/automation

Pushes a manually-exported Citi CSV straight into the Google Sheet, instead
of running the core converter's CLI and copy-pasting the output CSV by
hand. Reuses `@mint-csv-converter/core`'s import/convert logic unchanged;
this package only adds grouping-by-month, dedupe against previous runs, and
writing rows into the sheet — via the **Sheets API** directly (generic
spreadsheet mechanics), then finalizing them via the **Apps Script API**
(`scripts.run`, calling `finalizeAddedRows` — see
`packages/apps-script/README.md`, which needs to be deployed first).

## Setup

1. Deploy the Apps Script project as an **API Executable** and set up its
   OAuth credentials — see
   [`packages/apps-script/CLASP_SETUP.md`](../apps-script/CLASP_SETUP.md#9-one-time-setup-for-the-sync-api)
   for the full walkthrough (GCP project, enabling the Apps Script API,
   OAuth consent screen/client). You'll end up with a downloaded OAuth
   client secret JSON file and this script's ID.
2. Run the one-time interactive authorization (opens your browser once,
   saves a reusable token locally — see `src/scripts/authorize.ts`):

   ```bash
   GOOGLE_OAUTH_CLIENT_SECRET_PATH=/path/to/client_secret.json \
     pnpm exec tsx src/scripts/authorize.ts
   ```

   This saves credentials to `~/.config/mint-csv-converter/google-token.json`
   (git-ignored territory — never commit it). Re-run this if the token is
   ever revoked or deleted.

3. Create a git-ignored `.env` file (in this directory, or wherever you'll
   run the command from) with:

   ```
   SPREADSHEET_ID=<the sheet's ID, from its URL>
   APPS_SCRIPT_SCRIPT_ID=<same as .clasp.json's scriptId>
   GOOGLE_OAUTH_CLIENT_SECRET_PATH=/path/to/client_secret.json
   ```

   Node's built-in `--env-file` flag loads this without adding a `dotenv`
   dependency (Node 20.6+).

4. Build `packages/core` first — this package resolves
   `@mint-csv-converter/core` via its published `dist/`, not the TS source
   directly, so `pnpm --filter @mint-csv-converter/core build` needs to be
   re-run after any core changes before running automation.

## Running it

```bash
pnpm build   # from this directory, or `pnpm -r build` from the repo root
node --env-file=.env dist/sync.js --input /path/to/citi-export.csv Brian
```

Or during development, skip the build step:

```bash
node --env-file=.env --import tsx src/sync.ts --input /path/to/citi-export.csv Brian
```

`name` defaults to `Brian` if omitted, matching the core CLI. `--sync-state
<path>` overrides where the "newest date synced so far per payer" state
lives (default: `~/.config/mint-csv-converter/sync-state.json`) — delete
that file (or the relevant payer's entry in it) if you ever want to
reprocess a full export from scratch.

## What it does

1. Imports and normalizes the CSV via `@mint-csv-converter/core`'s
   `ImportFileToLines` (same Citi column-mapping as the core CLI).
2. Skips rows strictly older than the last synced date for this payer
   (tracked per-payer in the sync-state file). Same-day rows are always
   reprocessed rather than skipped — there's no unique transaction ID in
   Citi's export to dedupe on more precisely than date, so this trades an
   occasional visible duplicate row (easy to spot and delete by hand in the
   sheet) for never silently dropping a legitimate same-day transaction.
3. Runs the remaining rows through `CsvConverterFactory.convertToExpenseSplitting`
   (unchanged — same exclusion/classification logic as the CLI), grouped by
   transaction month.
4. For each month group with valid rows, `SheetsClient.addTransactionsForPeriod`
   writes `[description, payerName, amount, splitType]` (columns A-D only —
   E onward are computed server-side) into that period's tab via the
   **Sheets API** (finding it or duplicating "DUPLICATE ME" if it doesn't
   exist yet), then calls the Apps Script API's `finalizeAddedRows` to
   apply the same checkbox/percent defaulting and settle-up recalculation
   a manual entry would. If that finalize call fails after the Sheets API
   write already succeeded, it attempts a best-effort compensating
   rollback (deletes the rows it just inserted, or the whole tab if it was
   freshly created) before re-throwing — see `sheetsClient.ts` for details.
5. Writes excluded (invalid) rows to a local CSV via `ExportFileToLines`,
   same safety net as the core CLI's invalid-rows output.
6. Updates the sync-state file with the newest transaction date seen in
   this run.
