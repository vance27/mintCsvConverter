# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A TypeScript/pnpm monorepo that converts a Citi.com transaction export CSV into a CSV formatted for a Google Sheets expense-splitting workflow, and (in progress) pushes that data straight into the shared sheet via an extended Apps Script instead of manual copy-paste. It excludes personal-only, payer-specific transactions (transfers, individual purchases, etc.) and classifies every remaining transaction as either "split equally" (including known shared/joint bills) or "split variably" for a configurable set of vendors.

This was ported from an original Python implementation; see git history for that version if needed. The port fixed two real bugs discovered by testing against a real export:

- The Python version assumed Mint's CSV layout (`Date, Description, Original Description, Amount`). The actual input is Citi's layout (`Status, Date, Description, Debit, Credit, Member Name`) — completely different column order. Import now maps columns by header name instead of by position.
- Vendor-list matching (`personalExclusions`, `splitRulesDict`) is case-insensitive. Citi's descriptions are mostly ALL CAPS; several vendor-list entries (e.g. `'Costco'`, `'Web Authorized Pmt'`) are mixed/title case and never matched under case-sensitive comparison.
- Refund amounts (a populated `Credit` column that isn't a card payment) preserve their negative sign instead of being forced positive — see `normalizeAmount` in `importFileToLines.ts`.

## Package layout (pnpm workspace)

- `packages/core` — the conversion engine, ported 1:1 in behavior (plus the fixes above) from the original Python `csvTools`/`main.py`. Dependency-light: `csv-parse`/`csv-stringify` for CSV I/O, otherwise Node stdlib.
- `packages/automation` — Sheets HTTP client + sync orchestrator (see "Google Sheets automation" below).

Root-level tooling: `pnpm-workspace.yaml`, `tsconfig.base.json` (strict mode, extended per-package), `.npmrc` (`save-exact=true`), and `pnpm-workspace.yaml`'s supply-chain settings (`minimumReleaseAge`, `blockExoticSubdeps`, `trustPolicy`, `allowBuilds`) — **dependency versions are pinned exactly, no `^`/`~` ranges**; use `pnpm add --save-exact` (or rely on `.npmrc`) when adding anything new, and update `allowBuilds` deliberately rather than blanket-approving postinstall scripts.

## Running it

```bash
cd packages/core
pnpm build
node dist/main.js <input_file.csv> EXPENSE_SPLITTING <PayerName>
```

Or during development, skip the build step: `pnpm exec tsx src/main.ts <input_file.csv> EXPENSE_SPLITTING <PayerName>` from `packages/core`.

Example:

```bash
node dist/main.js transactions.csv EXPENSE_SPLITTING Brian
```

`<PayerName>` must exist (case-insensitively) as a key in `personalExclusions` in [packages/core/src/csvConverterFactory.ts](packages/core/src/csvConverterFactory.ts) — this determines which set of personal, non-splittable transaction descriptions get excluded for that payer. Currently supported names: `PATRICE`, `BRIAN`. `--help`/`-h` is also supported.

`EXPENSE_SPLITTING` is currently the only supported `outputFormat`; any other value throws an `Error` naming the bad format.

Run the full workspace test suite from the repo root with `pnpm test` (or `nx test @mint-csv-converter/core` for just the converter), and typecheck with `pnpm typecheck`. See "Task orchestration (Nx)" below.

## Architecture

Three-stage pipeline wired together in [packages/core/src/main.ts](packages/core/src/main.ts):

1. **Import** — `ImportFileToLines` ([packages/core/src/importFileToLines.ts](packages/core/src/importFileToLines.ts)) reads the input CSV, locates `Date`/`Description`/`Debit`/`Credit` by header name (case-insensitive, order-independent), and normalizes each row to `[date, description, '', amount]` — `amount` comes from whichever of Debit/Credit is populated, sign preserved (see refund handling above).
2. **Convert** — `CsvConverterFactory` ([packages/core/src/csvConverterFactory.ts](packages/core/src/csvConverterFactory.ts)) is keyed on `outputFormat` string, dispatching to a converter method (currently only `convertToExpenseSplitting`). That method:
   - Skips the header row (index 0).
   - Iterates rows in reverse, and for each row checks `isValidLine` against `personalExclusions[<PAYER_NAME>]` (case-insensitive substring match against `line[1]`, the description). Matching lines are personal spending and are routed to `invalidLines`; everything else is kept.
   - For kept lines, checks `isVariableSplit` against `splitRulesDict.VARIABLE` to decide whether the row is tagged `"Variably"` (split `%`/`%`) or `"Equally"` (split `TRUE`/`TRUE`). `splitRulesDict.SHARED` is documentation of known joint bills (e.g. mortgage, insurance) that also land in the `"Equally"` bucket — it isn't branched on separately in code since that's already the default for any non-excluded, non-variable transaction.
   - Returns a `[result, invalidLines]` tuple. Output columns are: `date + description`, payer name, amount (`line[3]`), split type, and two split-ratio columns.
3. **Export** — `ExportFileToLines` ([packages/core/src/exportFileToLines.ts](packages/core/src/exportFileToLines.ts)) writes both `result` and `invalidLines` out as separate CSV files, named `<name>_<timestamp>_<VALID|INVALID>_csvConverter.csv`, into the current working directory.

### Adding a new payer

Add a new uppercase key to `personalExclusions` in `CsvConverterFactory` with a list of description substrings that should be excluded (personal-only spending, transfers, etc.) for that payer. The key must match the `name` CLI arg uppercased. Matching is case-insensitive, so casing in the list doesn't need to match the export's casing.

### Adding a new output format

Add a new `outputFormat` branch in `getConverter` pointing to a new `convertTo*` method following the same `(lines, name) -> [result, invalidLines]` signature.

## Google Sheets automation

Input is always a manually-exported Citi CSV — Playwright-based export automation was considered and explicitly ruled out (bot-detection risk not worth it for this).

- [packages/apps-script/src/Code.ts](packages/apps-script/src/Code.ts) — the existing sheet's Apps Script, logic untouched above the marker comment (type annotations added for local dev only), plus an appended `doPost` Web App endpoint (`addTransactionsForPeriod`) that finds-or-creates the `"<Payer> <Period>"` tab (duplicating `"DUPLICATE ME"` to preserve styling), inserts rows above the `"TOTAL OWING"` marker, and reuses the existing `onSplitTypeChanged`/`calculate()` for defaulting and settle-up math. Apps Script can't run TypeScript directly, so `pnpm build` bundles this to `dist/Code.js` via Rollup — that's what actually gets deployed. See that directory's README for build/deployment steps — deploying is a manual, one-time step in the Apps Script editor or via `clasp`; it can't be scripted from here.
- `packages/automation` — [sheetsClient.ts](packages/automation/src/sheetsClient.ts) (thin HTTP client for the endpoint above), [sync.ts](packages/automation/src/sync.ts) (orchestrator: imports a CSV via `@mint-csv-converter/core`, groups by transaction month, dedupes against a local sync-state file tracking the newest date already pushed per payer, and POSTs each group). See that package's README for setup/usage. Depends on `@mint-csv-converter/core`'s built `dist/` output; Nx handles this automatically (see below) — you don't need to manually rebuild core first.

## Task orchestration (Nx)

Nx sits on top of the pnpm workspace as a task runner/cache — it doesn't replace pnpm as the package manager. `nx.json` configures it for **local caching only** (no Nx Cloud).

- Run tasks via `nx run <project>:<target>`, `nx run-many -t <target>`, or the root `package.json` scripts (`pnpm build`/`pnpm test`/`pnpm typecheck`, which just call `nx run-many -t <target>` for all three packages).
- Targets are largely *inferred*, not hand-written: `@nx/js/typescript` infers `build`/`typecheck` from each package's `tsconfig.json` (project-referenced, `composite: true`, orchestrated via `tsc --build` from the root [tsconfig.json](tsconfig.json)); `@nx/vitest` infers `test` from each `vitest.config.ts`; `@nx/rollup` infers apps-script's `build` from `rollup.config.mjs`. `nx.json`'s `targetDefaults` make `build`/`test`/`typecheck` depend on `^build` (a project's own workspace dependencies get built first) — this is what makes automation's dependency on core's `dist/` automatic.
- A package only needs an explicit script in its own `package.json` when the inferred target is wrong or missing — e.g. `packages/apps-script`'s `typecheck` script (`tsc --noEmit`) exists because that package isn't part of the composite project-reference graph (its tsconfig sets `noEmit: true` for Rollup bundling instead), so native inference can't run it in `tsc --build` mode and would otherwise silently no-op it.
- `packages/apps-script`'s `deploy` script (`nx build @mint-csv-converter/apps-script && clasp push`) is intentionally a plain script, not an Nx target — deploying to the live Apps Script project should stay a deliberate, manually-invoked action.
- After changing a package's `tsconfig.json` dependencies/references, run `nx sync:check` (or just `nx sync`) if you see a "workspace is out of sync" error — this keeps TS project references consistent with the Nx project graph.
- `nx` is installed as an exact-pinned root devDependency; invoke it via the local binary (`nx <command>`, not `npx nx`, which can silently resolve a different version) — a global shim (`volta install nx` or `npm i -g nx`) makes plain `nx` resolve to the workspace-local version automatically.
- All devDependencies (including build-time-only ones like `tslib`, `typescript`) live in the **root** `package.json` only; individual packages should not pin their own devDependencies — pnpm hoists them and both `require()` resolution and `pnpm exec`/script PATH resolution walk up to root's `node_modules`.
