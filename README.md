# Expense Splitting

Converts a Citi.com transaction export CSV into expense-splitting data for a
shared Google Sheet, and pushes it straight into that sheet via an extended
Apps Script instead of copy-pasting by hand — either from the CLI or from a
local web UI that also handles Costco/store receipt review and lets you
preview a sync before anything is pushed.

It excludes transactions that shouldn't be split (personal-only purchases,
transfers) and classifies everything else as split equally (including known
shared/joint bills) or split variably for a configurable set of vendors. For
variable-split vendors, a separate receipt pipeline extracts line-item
splits from the actual receipt (via a local vision model) and feeds them
into the sheet sync automatically, instead of defaulting to an even split.

TypeScript/pnpm monorepo — see [CLAUDE.md](CLAUDE.md) for full architecture
details. Six packages:

| Package                                                  | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)                         | The conversion engine and its CLI — reads a Citi export CSV, produces a valid/invalid split CSV. No external systems involved.                                                                                                                                                                                                                                                                                                                     |
| [`packages/automation`](packages/automation)             | Reuses `core` and pushes the valid rows straight into the Google Sheet — via the Sheets API for row mechanics, then the Apps Script API to trigger the checkbox/settle-up logic below — instead of copy-pasting the CSV output by hand. Authenticates as you via OAuth2 (one-time interactive consent, token stored locally). Also matches `'Variably'` rows against the receipt manifest to push a real learned split instead of an even default. |
| [`packages/apps-script`](packages/apps-script)           | The Google Apps Script bound to the sheet — your existing checkbox/settle-up logic, plus a `finalizeAddedRows` function `automation` calls via the Apps Script API. Deployed manually (as an API Executable, access restricted to you) via the Apps Script editor/`clasp`, not automatically from this repo.                                                                                                                                       |
| [`packages/receipts`](packages/receipts)                 | Given a store receipt PDF, extracts line items via a local Ollama vision model, resolves each item against a Prisma/SQLite datastore of learned typical splits, and persists everything transactionally. See [`costco-receipt-importer.md`](costco-receipt-importer.md) for the full phased plan.                                                                                                                                                  |
| [`packages/receipt-manifest`](packages/receipt-manifest) | The receipt manifest's type and read/write functions — a small, dependency-light package split out so `receipt-review` (which writes it) and `automation` (which reads it) don't have to pull in each other's dependency trees.                                                                                                                                                                                                                    |
| [`packages/receipt-review`](packages/receipt-review)     | A local single-user web app (Hono API + Vite/React) tying everything together: upload and review receipts (source PDF alongside an editable per-line split form), import a Citi CSV, review the staged transactions, and preview/run a sync into the Google Sheet — nothing reaches Sheets without an explicit action after previewing exactly what will happen.                                                                                   |

## Quick start — the web UI (recommended)

Covers CSV import, receipt review, transaction review, and sync preview/run
in one place.

```bash
pnpm install
nx run @mint-csv-converter/receipt-review:dev
```

See [`packages/receipt-review`](packages/receipt-review) and the "Receipt
review web UI" / "CSV import / transaction review / sync" sections of
[CLAUDE.md](CLAUDE.md) for how the pipeline fits together, and
[`packages/receipts/README.md`](packages/receipts/README.md) for one-time
Ollama/database setup the receipt pipeline needs.

## Quick start — just convert a CSV (CLI)

```bash
cd packages/core
pnpm build
node dist/main.js <input_file.csv> EXPENSE_SPLITTING <Person who paid for the expense>
```

Example:

```bash
node dist/main.js transactions.csv EXPENSE_SPLITTING Brian
```

## Quick start — convert and push to the sheet (CLI)

Requires the Apps Script project to be deployed as an API Executable
first — see [`packages/apps-script/README.md`](packages/apps-script/README.md)
and its [`CLASP_SETUP.md`](packages/apps-script/CLASP_SETUP.md), then
[`packages/automation/README.md`](packages/automation/README.md) for
one-time OAuth authorization and running `sync`.

Note: this CLI path and the web UI's sync both push to the same sheet but
track "already synced" state independently (a local `sync-state.json` file
vs. a per-row database flag) — mixing both for the same payer/period risks
double-syncing a transaction. Pick one path per payer/period.

## Development

Task orchestration is via [Nx](https://nx.dev) (local caching only, no Nx
Cloud) on top of the pnpm workspace — see [CLAUDE.md](CLAUDE.md) for
details.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```
