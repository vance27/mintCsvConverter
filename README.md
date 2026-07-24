# Expense Splitting CSV Converter

Converts a Citi.com transaction export CSV into a CSV formatted for a Google Sheets expense-splitting workflow.

It excludes transactions that shouldn't be split (personal-only purchases, transfers) and classifies everything else as split equally or split variably for a configurable set of vendors.

TypeScript/pnpm monorepo — see [CLAUDE.md](CLAUDE.md) for architecture details.

## Usage

```bash
cd packages/core
pnpm build
node dist/main.js <input_file.csv> EXPENSE_SPLITTING <Person who paid for the expense>
```

Example:

```bash
node dist/main.js transactions.csv EXPENSE_SPLITTING Brian
```

## Development

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
```
