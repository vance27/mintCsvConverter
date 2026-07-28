# Setting up clasp

[`clasp`](https://github.com/google/clasp) is Google's CLI for Apps Script —
it lets you edit this script's source in the repo (get diffs, git history,
code review) instead of only in the browser-based Apps Script editor, and
push changes from the command line.

This package builds `src/Code.ts` (TypeScript) down to plain JS at
`dist/Code.js` via `pnpm build` (see the main README) — `clasp` here is
configured to push from `dist/`, never from `src/` directly, since Apps
Script's runtime can't execute TypeScript.

This is a one-time setup per machine. You only need it if you want to edit
the script going forward via this repo — copy-pasting `dist/Code.js` into
the web editor (Option A in the main README) still works fine as a one-off.

## 1. Prerequisites

- Node.js (already required for the rest of this repo).
- The Google account that owns/can edit the "Expense Splitting" sheet.
- The Apps Script API enabled for that account: go to
  <https://script.google.com/home/usersettings> and turn on **Google Apps
  Script API**. This is a per-account setting, separate from any
  project-level API enablement — `clasp` will fail with `User has not
enabled the Apps Script API` until this is on.

## 2. Install and log in

```bash
pnpm add -g @google/clasp
clasp login
```

This opens a browser OAuth flow. Make sure you authorize with the **same
Google account** that owns the sheet/script — if you have multiple Google
accounts signed in, double check which one the browser picks. `clasp login`
writes credentials to `~/.clasprc.json` (global, not project-specific, and
not something to commit anywhere).

To confirm which account is logged in later: `clasp login --status`.

## 3. Find the script ID

From the sheet: **Extensions > Apps Script** to open the bound script's
editor, then the gear icon (**Project Settings**) in the left sidebar.
Copy the **Script ID** shown there.

## 4. Clone the project (only needed once, to bootstrap)

Clone into a scratch directory first, not directly into
`packages/apps-script/`, so you can inspect what comes down before touching
anything in the repo:

```bash
mkdir -p /tmp/apps-script-clone && cd /tmp/apps-script-clone
clasp clone <SCRIPT_ID>
```

This pulls down the real `appsscript.json` manifest (timezone, runtime
version, webapp config — whatever the project is actually configured with)
and the live script file. **Don't hand-write `appsscript.json` yourself** —
get it from a real clone, since a guessed one could silently change your
project's configuration; compare it against `packages/apps-script/appsscript.json`
in this repo and reconcile any differences by hand (small file, easy to
eyeball).

Diff the cloned script file against `pnpm build`'s output
(`packages/apps-script/dist/Code.js`) before assuming they match, in case
there are live edits that aren't reflected in `src/Code.ts` yet.

## 5. Wire this repo up to the project

`packages/apps-script/.clasp.json` is already set up with
`"rootDir": "dist"`, so `clasp` run from this directory pushes/pulls
`dist/Code.js` + `dist/appsscript.json` (the build output), never
`src/Code.ts`. Update its `scriptId` if you're pointing this repo at a
different script than what's already configured:

```json
{
  "scriptId": "<SCRIPT_ID>",
  "rootDir": "dist"
}
```

`.clasp.json` is git-ignored (contains your script ID — a credential-
adjacent value, no reason to commit it).

## 6. Build and push changes

```bash
cd packages/apps-script
pnpm build     # src/Code.ts -> dist/Code.js + dist/appsscript.json
clasp push     # or: nx deploy @mint-csv-converter/apps-script, which runs both
               # steps plus re-points the API Executable deployment (see step 8)
```

`clasp push` overwrites the live script with what's in `dist/` — review
your diff of `src/Code.ts` before pushing, same as any other deploy.
`clasp status` shows what would be pushed without actually pushing.

## 7. Ongoing workflow

- Edit `packages/apps-script/src/Code.ts` in this repo.
- `pnpm typecheck` for a fast local check without building.
- `nx deploy @mint-csv-converter/apps-script` (build + `clasp push` +
  `clasp deploy -i`, see step 8) to update the live script and its
  deployment.
- `clasp open` opens the project in the browser editor if you want to
  eyeball it or run something manually (e.g. the first-time authorization
  prompt Apps Script shows when a script requests new permissions —
  `clasp push` alone doesn't trigger that; open the editor and run any
  function once to grant access after adding new scopes/services).

## 8. Managing the deployment from the CLI

Push (step 6) updates the code the editor shows and what `clasp run` (see
below) executes, but it does **not** by itself change what a live
deployment serves — a deployment pins a specific _version_ of the code.
`clasp` can update an _existing_ deployment (keeping its ID stable) rather
than accidentally creating a new one:

```bash
clasp deployments                       # list existing deployments and their IDs
clasp deploy -i <DEPLOYMENT_ID>          # push a new version to an existing deployment
clasp deploy                             # create a new deployment (new ID) — avoid unless you mean to
```

`packages/apps-script/project.json`'s `deploy` Nx target already does
`clasp push && clasp deploy -i "$CLASP_DEPLOYMENT_ID"` — set
`CLASP_DEPLOYMENT_ID` (from `clasp deployments`' output) in your shell
environment once, and `nx deploy @mint-csv-converter/apps-script` handles
both steps together.

## 9. One-time setup for the sync API

`finalizeAddedRows` (in `src/syncApi.ts`) is called by `packages/automation`
via the **Apps Script API** (`scripts.run`) under your own Google identity
— not a Web App, not a shared-secret token. This needs real OAuth2
credentials, which needs a real (non-default) Google Cloud project. This
is one-time GCP Console setup, not something `clasp`/this repo can drive:

1. **Switch to a standard GCP project.** Apps Script editor → Project
   Settings → **Google Cloud Platform (GCP) Project** → switch off the
   auto-created default project to a real one (create one in
   [console.cloud.google.com](https://console.cloud.google.com) if you
   don't have one yet — this is free, no billing account needed for what
   follows).
2. **Enable the Apps Script API** for that GCP project: APIs & Services →
   Library → search "Apps Script API" → Enable. (Free — no billing
   account needed for this or the Sheets API at personal-project usage
   scale.)
3. **Enable the Sheets API** too, same place: APIs & Services → Library →
   search "Google Sheets API" → Enable. `packages/automation` calls this
   directly (not through Apps Script) for row mechanics, so it needs to be
   enabled separately from the Apps Script API above — easy to miss, since
   nothing else in this setup prompts for it. If you skip this, the first
   sync run fails with `Google Sheets API has not been used in project
<number> before or it is disabled`, with a direct enable link in the
   error; enabling it there works just as well, just wait a minute or two
   for it to propagate before retrying.
4. **Create an OAuth consent screen**: APIs & Services → OAuth consent
   screen → External → Testing mode (fine for personal use — avoids
   Google's app-verification process since only you'll ever authorize it)
   → add your own account as a test user.
5. **Create an OAuth 2.0 Client ID**, type **Desktop app** (APIs &
   Services → Credentials → Create Credentials). Copy its **client ID**
   and **client secret** — this is a credential, keep it local, never
   commit it (same treatment `.clasp.json` gets). Google only shows a
   client secret's value once, at creation (or right after clicking "Add
   Secret" to generate a new one) — if you lose it, generate a new secret
   rather than trying to retrieve the old one.
6. **Deploy as an API Executable**: Apps Script editor → Deploy → New
   deployment → type "API Executable" → access "Only myself" → Deploy.
   Note the **deployment ID** it gives you (also visible via
   `clasp deployments`) — the Apps Script API's `scripts.run` needs this,
   not the project's plain script ID (its own docs call this out: "As
   multiple executable APIs can be deployed for the same script, this
   field should be populated with the deployment ID instead of script
   ID"). This is what `packages/automation`'s `APPS_SCRIPT_SCRIPT_ID` env
   var should actually be set to, despite the name.
7. Check Project Settings → "Show `appsscript.json` manifest file" for
   the auto-populated `oauthScopes` list (Apps Script detects these from
   what services the code uses) — `packages/automation`'s one-time
   `authorize` script needs to request this same scope list.
8. Run `packages/automation`'s `authorize` script once (see that
   package's README) using the client ID/secret from step 5 — that
   captures and stores the OAuth token `packages/automation` uses on
   every sync run afterward.

Prefer `clasp deploy -i <existing deployment id>` for routine updates so
`packages/automation`'s configured `APPS_SCRIPT_SCRIPT_ID` doesn't need to
change every time you edit the script.

## Troubleshooting

- **`User has not enabled the Apps Script API`** — step 1 above; this is
  per-account, easy to miss.
- **`clasp push` succeeds but the sheet doesn't reflect the change** —
  confirm you ran `pnpm build` first (pushing stale `dist/` output is a
  common gotcha), that `.clasp.json`'s script ID matches the sheet's
  actual bound script (step 3), and that you're logged into the right
  account (`clasp login --status`).
- **Permission/authorization prompt on first run of a new function** —
  expected the first time a script requests a new scope (e.g. first time
  `doPost`/`PropertiesService` is exercised); open the project
  (`clasp open`) and run the function once from the editor to grant access
  interactively, which `clasp push` alone can't do.
