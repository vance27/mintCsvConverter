# Apps Script — settle-up finalize entry point

`src/Code.ts` is your existing "Expense Splitting" sheet's Apps Script
(checkbox/percent defaulting on edit, settle-up recalculation) — logic
unmodified, with type annotations added (via `@types/google-apps-script`)
for local IntelliSense/type-checking — plus one new function,
`finalizeAddedRows` (in `src/syncApi.ts`), called via the **Apps Script
API** (`scripts.run`, not a Web App). `packages/automation` writes raw row
data directly via the **Sheets API** (that's what it's built for — no
reason to route generic spreadsheet writes through Apps Script), then
calls `finalizeAddedRows` once to apply this sheet's checkbox/percent
defaulting and settle-up recalculation to those rows, the same way a
manual paste + dropdown selection would — without reimplementing that math
in TypeScript.

Apps Script's V8 runtime doesn't run TypeScript directly, so `pnpm build`
bundles/transpiles `src/Code.ts` down to plain JS at `dist/Code.js`
(via Rollup + `@rollup/plugin-typescript`) and copies `appsscript.json`
alongside it — `dist/` is what actually gets pushed, `src/Code.ts` is what
you edit and review.

## Building

```bash
pnpm install   # from the repo root, or this directory
pnpm build     # -> dist/Code.js + dist/appsscript.json
pnpm typecheck # tsc --noEmit against src/, no build needed for this
```

## Deploying this

You have two options — pick whichever you're more comfortable with. Either
way, **back up/diff against what's currently live first** (Extensions >
Apps Script from the sheet) so you don't accidentally lose any local edits
that aren't reflected in this file.

### Option A — copy-paste (simplest)

1. `pnpm build`.
2. Open the sheet, then Extensions > Apps Script.
3. Replace the contents of the script's `.gs`/`.js` file with
   `dist/Code.js`'s contents (not `src/Code.ts` — that's TypeScript source,
   the Apps Script editor can't run it).
4. Make sure the manifest (gear icon > `appsscript.json`, or the "Project
   Settings" view) matches `dist/appsscript.json`.
5. Save.

### Option B — clasp (versioned, diffable — recommended going forward)

See [CLASP_SETUP.md](CLASP_SETUP.md) for the full one-time setup (install,
login, enabling the Apps Script API, cloning, wiring `clasp` up to this
directory) and the ongoing edit/push workflow, including how to update an
existing deployment from the CLI without changing its ID.
`.clasp.json` here is already configured with `"rootDir": "dist"`, so
`pnpm build && clasp push` (or `nx deploy @mint-csv-converter/apps-script`,
which does both, plus re-points the deployment at the new version) pushes
the compiled output, never `src/Code.ts` directly.

## One-time setup for the sync API

`finalizeAddedRows` is called via the Apps Script API, not a Web App — this
needs a real Google Cloud project and OAuth2 credentials, not a Script
Property shared secret. Full steps (GCP project, enabling the Apps Script
API, OAuth consent screen/client, deploying as "API Executable") are in
[CLASP_SETUP.md](CLASP_SETUP.md#9-one-time-setup-for-the-sync-api) — the
short version:

1. Switch this script's associated Google Cloud project to a real
   *standard* project (Project Settings → Google Cloud Platform (GCP)
   Project), enable the **Apps Script API** there, and create an OAuth
   client (see CLASP_SETUP.md for exact steps — this is a one-time GCP
   Console setup, not something `clasp`/this repo can automate).
2. **Deploy → New deployment → API Executable**, access "Only myself".
3. Run `packages/automation`'s one-time `authorize` script once (see that
   package's README) to capture a stored OAuth token — that's what
   `packages/automation` uses to call `finalizeAddedRows`, no Script
   Property/shared-secret setup needed on this side at all.

## Testing it directly

`finalizeAddedRows` requires OAuth (see above), so it's not curl-able like
a Web App would be. Quickest manual check without wiring up
`packages/automation` fully: `clasp run finalizeAddedRows --params
'["Brian 07/26", 2, 1]'` (your own `clasp login` session is enough for
this — see [clasp's `run` docs](https://github.com/google/clasp/blob/master/docs/run.md)).
For a real end-to-end check, use `packages/automation`'s `sync` command
against a test export — see that package's README.
