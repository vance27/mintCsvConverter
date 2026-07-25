# Costco Receipt Importer (+ output sorting)

## Context

The biggest manual bottleneck in the expense-splitting workflow is going
through Costco receipts by hand: each receipt has many line items, each
split differently between the two payers, and today you eyeball them, do
the weighted math, and type a single aggregate pair of percentages into
the one "Variably" row that the *transaction* becomes in the sheet. Many
items repeat across trips (same item, drifting price, occasional
discounts), so there's real leverage in remembering an item's typical
split and price history instead of re-deciding every time.

**Store- and payer-agnostic by design:** Costco is the v1 focus, but
nothing is hardcoded to Costco or to Brian-as-payer. Patrice pays for
Target, so the system must allow a different person to be the payer and a
different store to be the source — Target and other stores should be able
to plug in later without a rebuild. v1 *tunes* for Costco; it isn't
*limited* to it.

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

Split percentages are *not* hardcoded `splitBrian`/`splitPatrice`
columns; store and payer are *not* hardcoded to Target/Brian. Everything
that could be "another person" or "another store" is a row, not a column,
so a third participant or a new store is a data change, not a schema
migration. Models:

- **Participant** — `id`, `name` (unique, e.g. "Brian", "Patrice"),
  `active`. Seeded with the two current participants.
- **Store** — `id`, `name` (unique, e.g. "Costco", "Target"). Namespaces
  item codes (Costco item 1234 ≠ Target item 1234) and lets extraction
  pick a store-specific prompt later.
- **Item** — canonical item, deduped on **`(storeId, itemCode)`**
  (unique) — the stable item number/SKU, *not* the name. `itemCode?` is
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
  `purchaseDate`, `total`, `subtotal`, `tax`, `status` (`EXTRACTED` |
  `REVIEWED` | `SUBMITTED`), `createdAt`. (The rendered page PNGs from
  extraction are cached next to it for fast display.)
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
on the receipt. Keeping them out means the datastore (and its backups
below) carry only benign item/price/split data.

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
  a fake and never hit a real model. Model name from env
  (`OLLAMA_MODEL`, default e.g. `llama3.2-vision`) — swappable.
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
  taxable?, discountAmount }] }`). The prompt **explicitly asks for the
  numeric item number per line** (the stable key). Grounded in the real
  sample (CHASKA #1646 receipt): each line is `<taxflag> <itemCode>
  <abbrev name> <extended price> <Y/N>`; multi-qty items add a separate
  `N @ unitprice` annotation whose product equals the extended price
  (e.g. `3 @ 3.99` → BLUEBERRIES `11.97`) — so `lineTotal` = printed
  price, `quantity`/`unitPrice` come from the `@` annotation (default
  qty 1). Costco **instant-savings discounts** print as separate negative
  lines referencing an item code → captured as `discountAmount`. Footer
  gives SUBTOTAL/TAX/**TOTAL**; TOTAL is the card-transaction match amount
  (236.92 in the sample). Zod guards against malformed JSON — treat model
  output as untrusted. Uses Ollama's structured-output (`format`) support
  to bias toward valid JSON. Prompt is store-aware (Costco tuned for v1; a
  Target variant slots in later).
- `src/normalizeItemName.ts` — fallback only, for stores/lines with no
  usable item code: deterministic normalization (uppercase, strip noise,
  collapse whitespace) → per-store `normalizedName` key. Pure,
  unit-tested. Item-code match is preferred whenever a code is present.
- `src/reconcile.ts` — deterministic arithmetic check on the extraction:
  Σ(lineTotal − discountAmount) ≈ subtotal, and subtotal + tax ≈ total
  (small rounding tolerance). Pure, unit-tested. **This is the safety net
  that makes an imperfect VLM acceptable** — we never trust the model for
  math; if a receipt doesn't reconcile, its `Receipt` is flagged
  low-confidence and sorted to the top of review, so a misread digit is
  caught, not silently propagated.

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
llama3.2-vision` once to fetch the model weights. After that the `ollama`
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

There is **no separate training step — reviewing a receipt *is* the
training.** Each correction becomes the memory used next time, so manual
work shrinks trip over trip:

- **First trip:** most item codes are unseen → each shows an even-split
  default flagged "new — please set." You set the splits; they become each
  item's remembered typical split (`ItemSplitDefault`).
- **Later trips:** previously-seen items come in **pre-filled with your
  last split**, labeled with *why* ("learned — always Brian," "last trip
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

## Phase 3 — Review web UI + manifest (sketch)

Local web app: upload PDFs → background extraction with a progress bar
→ paginated per-receipt review form. Each receipt's form shows **the
source PDF (or its rendered page image) side-by-side with the split
form** so anything that looks off can be cross-checked against the
original at a glance — item, price, price-history hint, editable per-item
% and display name, live aggregate. On submit: mark receipts
`REVIEWED`→`SUBMITTED`, update item split defaults, and write a
**manifest** JSON to `~/.config/mint-csv-converter/receipt-manifest.json`
keyed by receipt total (primary) with purchase-date proximity as tiebreak
→ `{ store, payer, percentages }`. Web stack (likely Vite + React + a
small Hono/Express backend reusing `packages/receipts`) decided at this
phase, not locked now.

**Auditability (annotated-PDF question).** Marking the *original* PDF in
place (e.g. "37% / 63%" on the BLUEBERRIES line) is **not trivial** — that
PDF has no text layer and the JSON extraction has no per-line coordinates,
so it would require adding coordinate-grounded OCR (Tesseract word boxes
or a grounding model). Deferred stretch, gated on that. The auditability
value is delivered cheaply instead by (1) the side-by-side UI above, and
(2) a **generated audit copy** — our own clean HTML/PDF table (item ·
price · split% · each person's share · receipt total · aggregate that
lands in the sheet), written next to the JSON snapshot as a permanent,
reviewable trail. In-place annotation of the original stays a later "nice
to have."

## Phase 4 — Sync integration (sketch)

In `packages/automation`'s sync path, for **any** `Variably` row (Costco,
Target, …), look up the manifest by amount (+date proximity) and fill the
percentage columns (`line[4]`/`line[5]`) instead of `'%'`/`'%'`. The
manifest carries store + payer + per-participant percentages, so it works
regardless of who paid or which store — not Costco/Brian-specific.
Matching key (amount-primary vs date) validated against a real export +
manifest — Citi's posting date can differ from the receipt date by a day
or two, so amount is the more reliable join. Unmatched variable rows fall
back to today's `%`/`%` placeholder behavior (never block a sync).

## Phase 5 — Output sorting (small, independent)

`CsvConverterFactory` already has a `sorted` flag and a working sort
(`csvConverterFactory.ts:112`), just defaulted off and never wired up.
Wire it on (surface via a CLI/sync flag or default-on) so similar
purchases group together — the sort key is `line[0]` (`description +
date`), which groups same-vendor purchases alphanumerically. Confirm the
key sorts the way you want on a real export; adjust to sort by description
alone if the trailing date fragments the grouping.

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
