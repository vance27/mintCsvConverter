# @mint-csv-converter/receipts

Extracts line items and per-participant splits from store receipt PDFs
(Costco tuned for v1) using a local vision model (Ollama), and remembers
each item's typical split and price history in a local SQLite datastore —
so repeat items pre-fill correctly and manual review shrinks trip over
trip. See [`costco-receipt-importer.md`](../../costco-receipt-importer.md)
at the repo root for the full design and phased plan; this package covers
**Phase 1**: headless extraction + datastore, driven by a CLI (no review
UI yet — that's Phase 3).

## Setup

1. **Install Ollama, run it as a background service, and pull a vision
   model** (one-time, per machine):

   ```bash
   brew install ollama
   brew services start ollama   # runs the server via launchd — survives logout/reboot, no terminal tab to keep open
   ollama pull qwen2.5vl:7b
   ```

   **Not `llama3.2-vision`** — its architecture (`mllama`) was dropped
   when Ollama rewrote its inference engine around v0.30.0 and was never
   implemented in the new one; every current Ollama version fails to load
   it (`unknown model architecture: 'mllama'`, confirmed against a real
   pull). Qwen2.5-VL uses a currently-supported architecture and is
   specifically tuned for documents/OCR/structured visual content, which
   is a better fit for receipts anyway.

   **This is still a large download — about 6 GB** — so budget time and
   disk space; it only needs to be pulled once. Everything Ollama
   downloads lives under `~/.ollama/models/` (`blobs/` for the actual
   weight files, `manifests/` mapping model names/tags to them).

   Ollama runs a local server at `http://localhost:11434` — nothing
   leaves your machine, no cloud account, no per-call cost. `brew
   services start` (rather than running `ollama serve` directly) is what
   avoids needing a dedicated terminal window: it's managed by `launchd`
   as `homebrew.mxcl.ollama`, starts automatically on login, and keeps
   running in the background. Check it's up any time with `curl
   http://localhost:11434` (expect `Ollama is running`) or `brew services
   list`; stop it with `brew services stop ollama` if you ever need to.
   The `ollama` npm dependency here just makes HTTP calls to that server.
   Override the model with `OLLAMA_MODEL`, or the host with `OLLAMA_HOST`,
   if needed.

   (If you'd rather not use `brew services` — e.g. non-Homebrew installs —
   `ollama serve` still works, just backgrounded and detached from the
   shell: `nohup ollama serve > /tmp/ollama.log 2>&1 & disown`.)

2. **Seed participants** (one-time; `ingestReceipt` deliberately throws on
   an unknown payer name rather than silently creating one, so a typo
   never quietly becomes a new "participant"):

   ```bash
   nx run @mint-csv-converter/receipts:seed -- Brian Patrice
   ```

   `seed`/`ingest`/`snapshot`/`restore` all `dependsOn` a `prisma-migrate`
   Nx target (`prisma migrate deploy`, non-interactive and a no-op if
   nothing's pending), so the first run of any of them automatically
   creates/updates `~/.config/mint-csv-converter/receipts.db`'s schema —
   no separate migration step to remember. Run it standalone if you ever
   want to: `nx run @mint-csv-converter/receipts:prisma-migrate`.

3. No `.env` is required beyond that — the datastore defaults to
   `~/.config/mint-csv-converter/receipts.db` (override with
   `DATABASE_URL`), matching the automation package's config-directory
   convention.

## Running it

```bash
nx run @mint-csv-converter/receipts:ingest -- --store Costco --payer Brian /path/to/receipt.pdf
```

If extraction doesn't reconcile (subtotal/tax/total *or* tender-vs-total
arithmetic doesn't add up), it's automatically retried from scratch up to
3 times before giving up — the model isn't perfectly deterministic, so a
second read sometimes gets a misread quantity right where the first
didn't. This isn't a guaranteed fix (a systematic misread can come back
identical on retry), so it's still worth checking a receipt against the
PDF by hand when it prints as unreconciled.

Prints each extracted line item (with its item code, price, and
per-participant split), whether the receipt's numbers reconciled and how
many attempts that took, how many items were never seen before, and the
aggregate percentage that would land in the sheet's two "Variably" cells.
If the purchase was split across payment methods (e.g. partly cash or
Costco Cash Rewards), it also prints the tender breakdown and the
card-matched amount — the portion that will actually show up on the
Citi CSV, since only that part hit the card.

Re-ingesting the same PDF (by content hash) is a no-op. Add `--snapshot`
to also write the JSON backup (see below) after ingesting.

## The datastore

Prisma 7 + SQLite (via the `better-sqlite3` driver adapter — no
query-engine binary at runtime). Schema: `prisma/schema.prisma`. Store,
participant, and split data are modeled relationally (rows, not columns),
so a new store (e.g. Target) or a third participant is a data change, not
a schema migration. Items are deduped on `(store, itemCode)` — the
receipt's printed item number/SKU, which is far more stable than the
abbreviated name — falling back to a normalized name only for
stores/lines with no code.

Changing the schema:

```bash
cd packages/receipts
prisma migrate dev --name <description>   # generates + applies a migration, regenerates the client
```

`prisma generate` also runs automatically before `build`/`typecheck`/`test`/`lint`
via the `prisma-generate` Nx target (`project.json`) — the generated client
under `src/generated/` is git-ignored and eslint-ignored, regenerated from
`prisma/schema.prisma` on demand.

Browse/edit the datastore directly with Prisma Studio:

```bash
nx run @mint-csv-converter/receipts:prisma-studio
```

### Backups

```bash
nx run @mint-csv-converter/receipts:snapshot   # writes data/snapshot.json
nx run @mint-csv-converter/receipts:restore     # rebuilds the DB from it
```

The snapshot is plain, deterministically-ordered JSON — readable diffs,
and safe to commit (to a private repo) since the datastore never stores
the receipt's member number or card digits in the first place. `restore`
is also how a fresh machine bootstraps.

## Package layout

- `src/renderPdf.ts` / `src/ollamaClient.ts` / `src/extractReceipt.ts` —
  PDF → page images → VLM structured extraction (zod-validated; model
  output is always treated as untrusted).
- `src/reconcile.ts` — arithmetic self-check (line sum vs. subtotal vs.
  total, and tenders vs. total when a breakdown was extracted) that flags
  a receipt as low-confidence without blocking ingest, rather than
  trusting the model's numbers.
- `src/extractReconciled.ts` — retries extraction (up to 3 attempts) until
  it reconciles, falling back to the last attempt (still flagged) if none
  do. `ingest.ts` uses this instead of calling `extractReceipt` directly.
- `src/normalizeItemName.ts` / `src/aggregate.ts` / `src/tender.ts` — pure
  helpers (item-name fallback key; rolling per-item splits up into the
  whole-receipt aggregate; deriving the card-charged portion of a receipt
  split across payment methods).
- `src/ingest.ts` — the pipeline tying the above together against the
  datastore; `src/scripts/ingest.ts` is its CLI entry.
- `src/snapshot.ts` / `src/restore.ts` — JSON backup/restore.
- `src/testing/testDb.ts` — spins up a real, fully-migrated temp SQLite DB
  for tests (no mocking of the datastore itself).
