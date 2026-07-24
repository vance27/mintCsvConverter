# Apps Script — Sheets write endpoint

`src/Code.ts` is your existing "Expense Splitting" sheet's Apps Script
(checkbox/percent defaulting on edit, settle-up recalculation) — logic
unmodified, with type annotations added (via `@types/google-apps-script`)
for local IntelliSense/type-checking — plus a new HTTP entry point appended
at the bottom (everything below the `// --- Everything below this line is
new ---` marker) so `packages/automation`'s sync tooling can push rows into
the sheet the same way a manual paste + dropdown selection does today,
without reimplementing any of the existing math in TypeScript.

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
existing Web App deployment from the CLI without changing its URL.
`.clasp.json` here is already configured with `"rootDir": "dist"`, so
`pnpm build && clasp push` (or `pnpm deploy`, which does both) pushes the
compiled output, never `src/Code.ts` directly.

## One-time setup after deploying the code

1. **Shared secret.** In the Apps Script editor: Project Settings > Script
   Properties > add a property named `SYNC_TOKEN` with a random value, e.g.
   generate one with `openssl rand -hex 32`. This is what `doPost` checks
   against the `token` field in each request — treat it like a password.
2. **Deploy as a Web App.** Deploy > New deployment > type "Web app" >
   Execute as "Me" > Who has access "Anyone with the link" > Deploy. Copy
   the Web App URL it gives you — that's what `packages/automation` will
   POST to.
   - When you edit the script later, use **Manage deployments > Edit >
     new version** on the *existing* deployment rather than creating a
     brand-new deployment, so the URL stays stable and you don't have to
     update it in `packages/automation`'s config every time.
3. Put the Web App URL and the `SYNC_TOKEN` value somewhere `packages/automation`
   can read locally (git-ignored `.env`, not committed) — see that package's
   README.

## Testing it directly (before any TypeScript touches it)

```bash
curl -X POST '<WEB_APP_URL>' \
  -H 'Content-Type: application/json' \
  -d '{
    "token": "<SYNC_TOKEN>",
    "payerName": "Brian",
    "periodLabel": "07/26",
    "rows": [
      ["Chipotle Mexican Grill 07/01/2026", "Brian", "28.18", "Equally"],
      ["Costco Wholesale 07/02/2026", "Brian", "150.00", "Variably"]
    ]
  }'
```

Expect `{"ok":true,"result":{"sheetName":"Brian 07/26","rowsAdded":2}}` back,
a `"Brian 07/26"` tab created (or reused) with the same styling as your
other tabs, the two new rows showing real checkboxes/percent cells (not raw
text), and the settle-up summary below "TOTAL OWING" recalculated.

Row shape sent in `rows` is `[description, payerName, amount, splitType]`
(columns A-D) — columns E onward are computed server-side by the existing
`onSplitTypeChanged`, not supplied by the caller.
