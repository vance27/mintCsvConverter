# Costco Receipt Importer (+ output sorting)

## Context

The biggest manual bottleneck in the expense-splitting workflow is going
through Costco receipts by hand: each receipt has many line items, each
split differently between the two payers, and today you eyeball them, do
the weighted math, and type a single aggregate pair of percentages into
the one "Variably" row that the _transaction_ becomes in the sheet. Many
items repeat across trips (same item, drifting price, occasional
discounts), so there's real leverage in remembering an item's typical
split and price history instead of re-deciding every time.

**Store- and payer-agnostic by design:** Costco is the v1 focus, but
nothing is hardcoded to Costco or to Brian-as-payer. Patrice pays for
Target, so the system must allow a different person to be the payer and a
different store to be the source — Target and other stores should be able
to plug in later without a rebuild. v1 _tunes_ for Costco; it isn't
_limited_ to it.

**Item identity keyed on item ID, not name:** Costco receipts carry a
stable item number/SKU per line; the abbreviated names drift and are
cryptic. So the datastore dedupes items on `(store, itemCode)`, falling
back to a normalized name only when a store's receipts lack codes.
New/unseen items are expected and fine — they're created on first sight
with a default split. The UI can set an editable **display name** per item
(stored in the DB) so you can make cryptic entries legible to yourself.

**Confirmed data model:** the sheet stays one-row-per-transaction. A
receipt maps to one aggregate set of percentages for the whole receipt
total, computed from per-item splits. Sync auto-fills those `%` cells
instead of the current `%`/`%` placeholders. This is "mostly current
state" — no change to sheet layout, apps-script finalize, or the
Sheets-API write path.

**Target end-to-end flow:** web UI → load receipt PDFs → local VLM
extracts line items in the background (progress bar) → best-guess per-item
splits from the datastore → paginated review UI (one receipt at a time,
editable per-item % and display name) → submit → update datastore + write
a manifest to a standard path → the existing `sync` reads the manifest
for variable-vendor transactions and fills in the percentages.

**Confirmed choices:** build **extraction-first** (prove the VLM works on
real receipts headlessly before building UI); **Ollama** for local vision;
**Prisma + SQLite** for the datastore. New package: `packages/receipts`.

**Phasing:** Phase 1 (detailed below) is the near-term build — headless
extraction + datastore + best-guess splits, driven by a CLI/Nx target.
Phases 2–4 are sketched; we'll detail each when we reach it. Phase 5
(output sorting) is small and independent and can land anytime.

## Commit strategy

- **Each phase lands as its own commit(s)** — no bundling multiple phases
  into one commit. Within a phase, commit in **smaller logical chunks**
  (e.g. Prisma schema/migration, then extraction, then ingest, then CLI)
  rather than one giant commit.
- **Never commit breaking changes or failing tests.** Before each commit,
  the relevant `nx` lint/typecheck/build/test must pass — a commit is a
  green checkpoint, so the history stays bisectable. If work is mid-flight
  and red, it doesn't get committed until it's green.
- No `Co-Authored-By` trailer (standing repo convention).

---

## Phase 1 — Headless extraction + datastore (near-term, detailed)

New package `packages/receipts` (ESM, strict TS, Vitest, its own
`tsconfig.json`/`vitest.config.ts`, inferred Nx targets — mirrors
`packages/automation`'s setup). Runtime deps (exact-pinned): `ollama`
(typed vision client), `@prisma/client`, `zod` (validate untrusted LLM
JSON), `pdf-to-img` (pure-JS PDF→PNG via pdfjs, no system binaries like
ghostscript). Dev/build: `prisma`.

### Datastore (Prisma + SQLite)

`packages/receipts/prisma/schema.prisma`, SQLite via
`DATABASE_URL` (default `~/.config/mint-csv-converter/receipts.db`, same
`~/.config/mint-csv-converter/` convention as `syncState.ts`'s
`defaultSyncStatePath()`).

Split percentages are _not_ hardcoded `splitBrian`/`splitPatrice`
columns; store and payer are _not_ hardcoded to Target/Brian. Everything
that could be "another person" or "another store" is a row, not a column,
so a third participant or a new store is a data change, not a schema
migration. Models:

- **Participant** — `id`, `name` (unique, e.g. "Brian", "Patrice"),
  `active`. Seeded with the two current participants.
- **Store** — `id`, `name` (unique, e.g. "Costco", "Target"). Namespaces
  item codes (Costco item 1234 ≠ Target item 1234) and lets extraction
  pick a store-specific prompt later.
- **Item** — canonical item, deduped on **`(storeId, itemCode)`**
  (unique) — the stable item number/SKU, _not_ the name. `itemCode?` is
  nullable; when a store's receipts lack codes we fall back to a
  `normalizedName` unique-per-store key instead. `displayName` (editable
  in the UI), `lastSeenName` (raw extracted name), `createdAt`.
- **ItemSplitDefault** — `itemId`, `participantId`, `percent` (0–100).
  One row per participant per item = the learned "typical split."
- **PriceObservation** — `itemId`, `receiptId`, `unitPrice`, `quantity`,
  `discountAmount`, `observedAt` (receipt date). Price-over-time /
  discount history.
- **Receipt** — `id`, `storeId`, **`payerId`** (the Participant who
  paid — not assumed to be Brian), `sourceSha256` (unique — dedupes
  re-ingesting the same PDF), `sourcePath` (the retained source PDF,
  copied into `~/.config/mint-csv-converter/receipts/<sha>.pdf` on ingest
  so the review UI can show the original alongside the form),
  `purchaseDate`, `total`, `subtotal`, `tax`, `cardAmount` (the portion of
  `total` actually charged to a card — see "Tender breakdown" below),
  `status` (`EXTRACTED` | `REVIEWED` | `SUBMITTED`), `createdAt`. (The
  rendered page PNGs from extraction are cached next to it for fast
  display.)
- **ReceiptTender** — `id`, `receiptId`, `kind` (`CARD` | `CASH` |
  `COSTCO_CASH_REWARD` | `OTHER`), `label` (printed method name, never a
  card/account number), `amount`. One row per payment line on the
  receipt footer.
- **LineItem** — `receiptId`, `itemId?` (null until matched), `rawItemCode`,
  `rawName`, `unitPrice`, `quantity`, `lineTotal`, `discountAmount`,
  `reviewed`.
- **LineItemSplit** — `lineItemId`, `participantId`, `percent` (0–100).
  Per-item best guess (seeded from `ItemSplitDefault`), editable in
  review. Percentages per line item sum to 100.

Migrations committed under `prisma/migrations/`. `src/db.ts` exports a
singleton Prisma client. Store/Participant seed via a small seed script.

**We deliberately do NOT store** the receipt's member number or card
digits — they aren't needed for splitting and they're the only real PII
on the receipt. `ReceiptTender.label` captures the payment _method_
("Card", "Cash", "Costco Cash Reward") but the extraction prompt
explicitly instructs the model never to include a card number or any of
its digits, even masked. Keeping them out means the datastore (and its
backups below) carry only benign item/price/split data.

### SQLite vs Postgres, and git-versioned backups

- **SQLite, not Postgres.** Single-user local tool, tiny data, no server
  process to run — SQLite is a single file and zero-ops. Postgres would
  add a daemon for no benefit here. Prisma keeps the door open: if the web
  UI ever becomes a hosted multi-device service, switching is a `provider`
  change + regenerated migrations, not a rewrite.
- **Backups to GitHub — via a JSON snapshot, not the binary `.db`.** After
  each ingest/review run, `src/snapshot.ts` exports the whole datastore to
  a deterministic, sorted JSON file (`packages/receipts/data/snapshot.json`)
  and that's what gets committed — text diffs are readable ("item X's
  typical split 50→60"), restore is a re-seed from the snapshot, and it's
  a human-reviewable record. The working `.db` stays git-ignored. A
  matching `src/restore.ts` rebuilds the DB from the snapshot (also how a
  fresh machine bootstraps). Auto-commit of the snapshot after a run is
  opt-in (a flag), not silent. Since PII is excluded above, the snapshot
  is safe to push; use a private repo regardless.

### VLM extraction

- `src/ollamaClient.ts` — thin wrapper over the `ollama` package's
  vision chat, **injectable via an interface** (same testability pattern
  as `SheetsClient`'s `SpreadsheetsClient`/`ScriptClient`), so specs pass
  a fake and never hit a real model. Model name from env (`OLLAMA_MODEL`,
  default `qwen2.5vl:32b`) — swappable. Not `qwen2.5vl:7b`: confirmed
  against a real receipt that it reliably misattributes a `N @ unitPrice`
  annotation to the wrong neighboring item (reproducible across repeated
  attempts, prompt tightening, and a retry loop — see
  `extractReconciled.ts`); `32b` got the same receipt right twice in a
  row, at the cost of ~28GB resident memory and ~130-170s/call vs `7b`'s
  few seconds — `7b` stays available via `OLLAMA_MODEL` override for
  lower-memory machines or when speed matters more. Not `llama3.2-vision`
  either: its architecture Ollama dropped support for around v0.30.0; it
  does still run on a manually-installed pre-rewrite binary and gets
  receipts right, but only accepts one image per call (breaks multi-page
  receipts) with inconsistent 53s-5min+ latency, and requires maintaining
  an unmanaged second Ollama install — not worth it.
- `src/renderPdf.ts` — receipts are **PDFs**. Render each page to a PNG
  buffer with `pdf-to-img` (pure JS). A Costco receipt is usually one
  page; handle multi-page by rendering all and feeding them together to
  the VLM. (If a PDF turns out to carry a real text layer, pdfjs could
  read the text directly — cheaper/more accurate than vision — but the
  baseline is render→VLM; text-layer fast-path is an easy later
  optimization.)
- `src/extractReceipt.ts` — takes a PDF path, renders it via
  `renderPdf`, base64-encodes the page image(s), sends them with a
  structured-extraction prompt requesting JSON, and validates the
  response with a **zod** schema (`{ store?, purchaseDate, subtotal, tax,
total, items: [{ itemCode, rawName, quantity, unitPrice, lineTotal,
taxable?, discountAmount }], tenders: [{ kind, label, amount }] }`).
  The prompt **explicitly asks for the numeric item number per line**
  (the stable key). Grounded in the real sample (CHASKA #1646 receipt):
  each line is `<taxflag> <itemCode> <abbrev name> <extended price>
<Y/N>`; multi-qty items add a separate `N @ unitprice` annotation whose
  product equals the extended price (e.g. `3 @ 3.99` → BLUEBERRIES
  `11.97`) — so `lineTotal` = printed price, `quantity`/`unitPrice` come
  from the `@` annotation (default qty 1). Costco **instant-savings
  discounts** print as separate negative lines referencing an item code →
  captured as `discountAmount`. Footer gives SUBTOTAL/TAX/**TOTAL**
  (236.92 in the sample), followed by the **tender breakdown** — usually
  one `kind: "CARD"` line equal to TOTAL, but a purchase split across
  payment methods (partly cash, partly Costco Cash Reward) prints more
  than one; `kind` is constrained to `CARD | CASH | COSTCO_CASH_REWARD |
OTHER` and `label` is instructed to never carry a card number, even
  masked. Zod guards against malformed JSON — treat model output as
  untrusted. Uses Ollama's structured-output (`format`) support to bias
  toward valid JSON. Prompt is store-aware (Costco tuned for v1; a Target
  variant slots in later).
- `src/normalizeItemName.ts` — fallback only, for stores/lines with no
  usable item code: deterministic normalization (uppercase, strip noise,
  collapse whitespace) → per-store `normalizedName` key. Pure,
  unit-tested. Item-code match is preferred whenever a code is present.
- `src/reconcile.ts` — deterministic arithmetic check on the extraction:
  Σ(lineTotal − discountAmount) ≈ subtotal, subtotal + tax ≈ total, and
  (when tenders were extracted) Σ tenders ≈ total (small rounding
  tolerance; the tender check is skipped, not failed, when no tender
  lines were extracted). Pure, unit-tested. **This is the safety net
  that makes an imperfect VLM acceptable** — we never trust the model for
  math; if a receipt doesn't reconcile, its `Receipt` is flagged
  low-confidence and sorted to the top of review, so a misread digit is
  caught, not silently propagated.
- `src/tender.ts` — pure helper deriving `cardAmount` (Σ of `CARD`-kind
  tenders, falling back to the full `total` when no tender breakdown was
  extracted — the common all-card case). Persisted on `Receipt` at
  ingest time as the denormalized amount Phase 4 sync will match against
  the Citi CSV, since `total` itself only matches when the whole receipt
  was paid by card.
- `src/extractReconciled.ts` — wraps `extractReceipt` + `reconcile` in a
  bounded retry loop (`MAX_EXTRACTION_ATTEMPTS = 3`): re-extracts from
  scratch whenever a result fails to reconcile, since the VLM isn't
  perfectly deterministic and a second read sometimes gets a
  misattributed quantity annotation right where the first didn't. Never
  blocks — if no attempt reconciles, the last attempt is kept anyway,
  still flagged low-confidence. `ingest.ts` calls this instead of
  `extractReceipt` directly; `IngestResult.attempts` surfaces how many it
  took (1 = reconciled first try) so the CLI can report it. Not a
  guaranteed fix: confirmed against a real receipt that a misread can
  come back byte-identical on a fresh call when the model has a
  systematic bias for that specific layout, not just random noise — this
  raises the fraction needing zero manual review, it doesn't eliminate
  the need for Phase 3's review UI.

### Extraction reliability — no model training needed

**No fine-tuning/training.** That would need a labeled receipt dataset +
GPU + MLOps, and it's unnecessary. Reliability comes from, in order of
leverage: (1) Ollama **structured output** (`format` = our JSON schema) so
the model can't emit malformed/oddly-shaped JSON; (2) a **layout-aware
prompt** with the known Costco line structure + a worked example; (3) the
**`reconcile.ts` arithmetic check** above as the deterministic backstop;
(4) **item-code cross-check** against stored history to catch OCR drift;
(5) cheap knobs — **high-DPI render** and a **bigger local model** if
hardware allows. The **review UI with the source PDF side-by-side** is the
ultimate backstop — the model only needs to produce a good first draft. If
the base model underperforms, the escalation ladder is prompt → higher DPI
→ bigger local model → (last resort) cloud VLM; training is not on the
ladder.

### Ingest + best-guess splits

`src/ingest.ts` (takes the PDF path + store + payer):

1. Hash the PDF (`sourceSha256`); skip if a Receipt with that hash
   already exists (idempotent re-runs).
2. `extractReceipt` → structured line items.
3. Per line item: resolve `Item` by `(storeId, itemCode)` when a code is
   present, else by the per-store `normalizedName` fallback;
   find-or-create. If the item existed, seed `LineItemSplit` rows from its
   `ItemSplitDefault` (the learned typical split); if new, default to an
   even split across active participants and flag unreviewed. Record a
   `PriceObservation` and compute `discountAmount` / price-change vs. the
   item's most recent observation.
4. Run `reconcile` on the extraction; store the result (a `reconciled`
   flag / delta on `Receipt`) so review can surface low-confidence
   receipts first.
5. Persist `Receipt` (`status: EXTRACTED`, with `storeId`/`payerId`) +
   `LineItem`s + splits in one transaction.

Aggregate helper `src/aggregate.ts`: for each participant,
`percent = round( Σ(lineTotal · itemSplit/100) / total · 100 )`, returned
as a `{ [participant]: percent }` map (participant-agnostic; the two-cell
sheet row just reads the two current participants). Pure, unit-tested.

### CLI entry (Phase 1 driver — no UI yet)

`src/scripts/ingest.ts` + an Nx `ingest` target in
`packages/receipts/project.json` (mirrors automation's `authorize`/`sync`
targets, `--env-file=.env`): `nx run @mint-csv-converter/receipts:ingest
-- --store Costco --payer Brian <pdf-path...>` (store/payer default to
Costco/Brian for v1 convenience but are explicit args, not baked in).
Prints the extracted items, per-item best-guess splits, and the computed
aggregate for eyeballing against the real receipt.

### Nx / pnpm / Prisma wiring

- Add `packages/receipts` to the workspace (already globbed by
  `packages/*`). All devDeps go in **root** `package.json` per repo
  convention; runtime deps in the package's own `package.json`,
  exact-pinned.
- Prisma needs a codegen + native engine build step. Add a `prisma`
  entry to `pnpm-workspace.yaml`'s `allowBuilds` (deliberately, alongside
  the documented `esbuild`/`nx` entries), and a `prisma-generate` Nx
  target that `build`/`typecheck` `dependsOn`, so the generated client
  exists before TS compiles. Document in the package README + CLAUDE.md.
- `.env` / `receipts.db` are covered by the root `.gitignore` (`.env`, and
  add `*.db`).

### What Ollama actually is

Ollama isn't a Docker image you have to wire up — it's a small native app
that runs a local background server on `http://localhost:11434`. On macOS:
`brew install ollama` (or the download from ollama.com), then `ollama pull
qwen2.5vl:32b` once to fetch the model weights. After that the `ollama`
npm package in `packages/receipts` just makes HTTP calls to that local
server — nothing leaves your machine, no cloud account, no per-call cost.
(A Docker image exists too, but it's not needed on macOS.) Exact steps go
in the package README.

### Phase 1 verification

- `nx run-many -t lint typecheck build test` clean; new specs
  (`normalizeItemName`, `reconcile`, `aggregate`, `renderPdf` against a
  tiny fixture PDF, `extractReceipt` against a fake Ollama client
  returning canned JSON, `ingest` against a temp SQLite DB) pass.
- **Real format confirmed from the sample** (`~/Downloads/Orders &
Purchases _ Costco.pdf`, the CHASKA #1646 receipt): 2-page PDF, **no
  text layer** (render→VLM required), and — importantly — **every line
  carries a clean numeric item code**, so the `(store, itemCode)` key is
  solid for Costco warehouse receipts; the name fallback is only for other
  stores.
- **Manual, on your end** (needs a real Ollama + real receipts): install
  Ollama as above, pull a vision model, run `nx run
@mint-csv-converter/receipts:ingest -- --store Costco --payer Brian
"~/Downloads/Orders & Purchases _ Costco.pdf"`, and check extracted line
  items against the real receipt. **This is the make-or-break step** —
  real-world extraction accuracy is the main risk and the whole reason
  we're doing extraction-first. Iterate on prompt/model here before
  investing in UI.

---

## Phase 2 — Learning loop (experience)

There is **no separate training step — reviewing a receipt _is_ the
training.** Each correction becomes the memory used next time, so manual
work shrinks trip over trip:

- **First trip:** most item codes are unseen → each shows an even-split
  default flagged "new — please set." You set the splits; they become each
  item's remembered typical split (`ItemSplitDefault`).
- **Later trips:** previously-seen items come in **pre-filled with your
  last split**, labeled with _why_ ("learned — always Brian," "last trip
  70/30"). Right guess → do nothing. You only touch new or changed items.
- **A few months in:** the staples auto-guess correctly; review collapses
  to the handful of new/changed items per trip. That's the payoff.

On-screen support per item: the pre-filled guess + its provenance
(new / learned-from-N-trips / last value); **price-history context**
("usually $13.89, no change" vs. "was $10.99 → now $13.89 (+26%)" or a
discount flag) that both sanity-checks the VLM extraction and informs the
split; new/low-confidence items **sorted to the top**; and persisted
**display-name renames** (cryptic "PRONAMEL TP" → "Sensodyne Pronamel"
stays fixed going forward).

Update rule: **last-value-wins, deliberately** (not just for v1). The
default always adapts to the most recent split you set, so the occasional
one-off event — which may follow no pattern — simply becomes the new
normal rather than being averaged away. This is an explicit constraint on
any future refinement: don't smooth the history (e.g. most-common /
confidence-weighted) in a way that resists a fresh correction — the latest
correction should always win. Every split is still retained as history
(`LineItemSplit` rows across receipts) for context/price display, not for
overriding the latest value. Items whose split legitimately varies
trip-to-trip are just overridden each time, aided by the price context.

## Phase 3 — Review web UI + manifest (done)

New package `packages/receipt-review`: a local, single-user web app —
Hono backend + Vite/React frontend, no router library and no
TanStack Query/Redux (the whole app is one upload screen, one queue
list, and one review form, so plain `useState`/`useEffect` is enough).
Upload PDFs → background extraction (kicked off via the existing
`ingestReceipt`, tracked in an in-memory job map since a lost job on
restart is harmless given `ingestReceipt`'s idempotent-by-content-hash
design) with the client polling every 2s (extraction takes ~130-170s
with the default model — SSE/WebSockets would be overkill for that
cadence) → a review screen per receipt, one at a time, with **the
source PDF embedded directly** (an `<iframe>` on the
`GET /api/receipts/:id/source.pdf` endpoint — browsers render PDFs
natively, so no rasterization is needed for the primary side-by-side
view; a secondary on-demand-rendered, in-memory-only-cached page-image
endpoint exists for thumbnails) alongside the split form — item,
price, price-history hint, new-vs-learned provenance, editable per-item
% and display name, a live client-side aggregate preview. `hono/client`
generates a fully-typed fetch client from the server's own route
definitions (`hc<AppType>()`), zero codegen; `@hono/zod-validator`
gives the one JSON-bodied route (the line-item split PATCH) a properly
typed request too, not just a typed response.

**Submitting is a straight `EXTRACTED` → `SUBMITTED` transition, not
the three-state `EXTRACTED`/`REVIEWED`/`SUBMITTED` sketched below** —
`Receipt.status` is now a real Prisma `enum ReceiptStatus` (was a
free-form string), but collapsed to two values. A separate `REVIEWED`
status would only add a batch-submit UI concern (a distinct
review-vs-submit action per receipt) with no real payoff for a
single-person reviewer working one receipt at a time; `LineItem.reviewed`
(also newly wired up — was an unused schema column before this phase)
already carries the finer-grained "was this specific line looked at"
signal. Submitting, in one transaction, upserts each item's
`ItemSplitDefault` to the just-confirmed split (Phase 2's "the latest
correction always wins" rule) and writes both the **manifest** JSON to
`~/.config/mint-csv-converter/receipt-manifest.json` — a flat array of
`{ receiptId, store, payer, cardAmount, purchaseDate, percentages }`
entries, upserted by `receiptId` (not an object keyed by stringified
`cardAmount`, since two receipts can legitimately share one) — and a
**generated audit-copy** HTML file to
`~/.config/mint-csv-converter/receipt-audits/<receiptId>.html` (see
"Auditability" below for why that path, not literally next to the
snapshot).

**Auditability (annotated-PDF question).** Marking the _original_ PDF in
place (e.g. "37% / 63%" on the BLUEBERRIES line) is **not trivial** — that
PDF has no text layer and the JSON extraction has no per-line coordinates,
so it would require adding coordinate-grounded OCR (Tesseract word boxes
or a grounding model). Deferred stretch, gated on that. The auditability
value is delivered cheaply instead by (1) the side-by-side UI above, and
(2) a **generated audit copy** — our own clean HTML table (item · price ·
split% · each person's share · receipt total · aggregate). This lives
under `~/.config/mint-csv-converter/`, the same convention as the
datastore/retained-PDFs/manifest, rather than literally "next to the
[git-committed] JSON snapshot" as originally phrased — these are
generated, potentially-numerous personal artifacts, not something that
belongs in the git-tracked `data/` directory alongside the snapshot. In-place
annotation of the original stays a later "nice to have."

## Phase 4 — Sync integration (done)

`packages/automation`'s sync path now matches every synced `'Variably'` row
(Costco, Target, …) against the receipt manifest and, on a match, fills the
sheet's percentage columns with the real split instead of the `'%'`/`'%'`
placeholder — while never blocking a sync when there's no match. This landed
as three pieces:

- **Manifest as a shared workspace package.** `ManifestEntry`/`Manifest`/
  `readManifest`/`appendManifestEntry` were promoted out of
  `packages/receipt-review` into a new, dependency-light
  `packages/receipt-manifest` (Node `fs`/`path` only — no Hono/React, no
  Prisma/Ollama), rather than either hand-duplicating the shape in
  `automation` or bolting it onto `packages/receipts` (which would have
  dragged Prisma/Ollama into `automation`'s dependency graph for no reason).
  Both `receipt-review` (writer) and `automation` (reader) depend on it via
  `workspace:*`; Nx's inferred `^build`/typecheck graph handles ordering
  automatically, same as `core`.
- **Matching (`packages/automation/src/manifestMatch.ts`).** For each
  `'Variably'` row, `matchManifestEntry` filters manifest entries to the
  row's payer, a store name that's a substring of the transaction
  description (the `VARIABLE` vendor list entries, `'Costco'`/`'TARGET'`,
  already equal the manifest's store names — not a coincidence), and
  `cardAmount` within a cent of the transaction amount (not `total`, so
  split-tender receipts — partly cash/Costco Cash Reward — still join
  correctly). Multiple same-amount candidates tiebreak on whichever
  `purchaseDate` is closest to the transaction's date (Citi's posting date
  can differ from the receipt date by a day or two, so amount stays the
  primary key). No match (or an empty manifest) returns `null`, and the row
  keeps today's placeholder behavior — a sync is never blocked on a
  manifest lookup.
- **Applying the match — Apps Script, not the Sheets API.** A match's
  percentages travel as `AddTransactionsRequest.rowPercentages`
  (participant-name-keyed, e.g. `{ Brian: 62, Patrice: 38 }`, aligned 1:1
  with `rows`) through `sheetsClient.ts` into the Apps Script API's
  `finalizeAddedRows` call, **not** written positionally via the Sheets API
  `values.update` (which stays `A:D`-only, unchanged) — automation doesn't
  know the sheet's actual participant column order, only Apps Script does.
  This turned out to be load-bearing, not optional: `finalizeAddedRows`
  already called `onSplitTypeChanged` unconditionally for every inserted
  row, which unconditionally resets a `'Variably'` row's participant
  columns to an even default — so percentages written any other way would
  have been immediately clobbered. `finalizeAddedRows` now takes a per-row
  `rowPercentages` array; for a row with a match that covers every
  participant column exactly, the new `sheetLayout.ts#applyRowPercentages`
  writes it directly (resolving participant name → column via the existing
  `getParticipantNames`/`getParticipantIndexByName`); everything else
  (`null`, or a partial/mismatched participant set) falls back to
  `onSplitTypeChanged`'s default fill exactly as before. **Redeploying the
  Apps Script build is required** before a real sync picks this up.

## Phase 5 — Output sorting (done)

`CsvConverterFactory`'s `sorted` instance flag now defaults to `true`
(was `false`, never wired up) — no new CLI/sync flag, matching this
being a small/independent phase and the repo's no-premature-flags
convention. Both the standalone CLI (`main.ts`) and `packages/automation`'s
sync path pick it up automatically since both just `new CsvConverterFactory()`.
The existing sort key (`line[0]`, `"<description> <date>"`) groups
same-vendor purchases together as intended — description sorts first,
date is only a same-description tiebreak, so the trailing-date concern
this phase was originally scoped to double-check didn't need any changes.
Set an instance's `sorted = false` to restore the old unsorted
(reverse-input-order) behavior.

---

## Notes / assumptions to confirm during build

- Receipt input is **PDF** (confirmed). Rendered to page images for the
  VLM; multi-page handled. Text-layer fast-path is a possible later
  optimization.
- Splits are stored **participant-agnostically** (Participant +
  LineItemSplit/ItemSplitDefault tables), so a third person can be added
  later without a schema migration. The review UI and the sheet row stay
  two-participant for now — this is a storage decision, not an
  N-participant feature.
