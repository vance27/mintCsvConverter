# Expense Splitting

Converts a Citi.com transaction export CSV into expense-splitting data for
a shared Google Sheet, and (optionally) pushes it straight into that sheet
instead of copy-pasting by hand.

It excludes transactions that shouldn't be split (personal-only purchases,
transfers) and classifies everything else as split equally or split
variably for a configurable set of vendors.

TypeScript/pnpm monorepo — see [CLAUDE.md](CLAUDE.md) for full architecture
details. Three packages:

| Package | What it is |
| --- | --- |
| [`packages/core`](packages/core) | The conversion engine and its CLI — reads a Citi export CSV, produces a valid/invalid split CSV. No external systems involved. |
| [`packages/automation`](packages/automation) | Reuses `core` and pushes the valid rows straight into the Google Sheet via the endpoint below, instead of copy-pasting the CSV output by hand. |
| [`packages/apps-script`](packages/apps-script) | The Google Apps Script bound to the sheet — your existing checkbox/settle-up logic, plus an HTTP endpoint `automation` calls into. Deployed manually via the Apps Script editor, not from this repo. |

## Quick start — just convert a CSV

```bash
cd packages/core
pnpm build
node dist/main.js <input_file.csv> EXPENSE_SPLITTING <Person who paid for the expense>
```

Example:

```bash
node dist/main.js transactions.csv EXPENSE_SPLITTING Brian
```

## Quick start — convert and push to the sheet

Requires the Apps Script endpoint to be deployed first — see
[`packages/apps-script/README.md`](packages/apps-script/README.md), then
[`packages/automation/README.md`](packages/automation/README.md) for
configuring and running `sync`.

## Development

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
```
