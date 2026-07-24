# @mint-csv-converter/automation

Pushes a manually-exported Citi CSV straight into the Google Sheet, instead
of running the core converter's CLI and copy-pasting the output CSV by
hand. Reuses `@mint-csv-converter/core`'s import/convert logic unchanged;
this package only adds grouping-by-month, dedupe against previous runs, and
the HTTP call to the deployed Apps Script endpoint (see
`packages/apps-script/README.md` for deploying that first).

## Setup

1. Deploy the Apps Script Web App (see `packages/apps-script/README.md`) and
   have its URL and `SYNC_TOKEN` ready.
2. Create a git-ignored `.env` file (in this directory, or wherever you'll
   run the command from) with:

   ```
   SHEETS_WEBAPP_URL=https://script.google.com/macros/s/.../exec
   SHEETS_SYNC_TOKEN=<the SYNC_TOKEN you set as an Apps Script property>
   ```

   Node's built-in `--env-file` flag loads this without adding a `dotenv`
   dependency (Node 20.6+).

3. Build `packages/core` first — this package resolves
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
4. For each month group with valid rows, POSTs `[description, payerName,
   amount, splitType]` (columns A-D only — E onward are computed
   server-side by the existing Apps Script logic) to the Apps Script
   endpoint, which finds-or-creates that period's tab and applies the same
   checkbox/percent defaulting and settle-up recalculation a manual entry
   would.
5. Writes excluded (invalid) rows to a local CSV via `ExportFileToLines`,
   same safety net as the core CLI's invalid-rows output.
6. Updates the sync-state file with the newest transaction date seen in
   this run.
