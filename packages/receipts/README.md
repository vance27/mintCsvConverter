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

1. **Install Ollama and pull a vision model** (one-time, per machine):

   ```bash
   brew install ollama
   ollama pull llama3.2-vision
   ```

   Ollama runs a local background server at `http://localhost:11434` —
   nothing leaves your machine, no cloud account, no per-call cost. The
   `ollama` npm dependency here just makes HTTP calls to that server.
   Override the model with `OLLAMA_MODEL`, or the host with `OLLAMA_HOST`,
   if needed.

2. **Seed participants** (one-time; `ingestReceipt` deliberately throws on
   an unknown payer name rather than silently creating one, so a typo
   never quietly becomes a new "participant"):

   ```bash
   nx run @mint-csv-converter/receipts:seed -- Brian Patrice
   ```

3. That's it — no `.env` is required. The datastore defaults to
   `~/.config/mint-csv-converter/receipts.db` (override with
   `DATABASE_URL`), matching the automation package's config-directory
   convention.

## Running it

```bash
nx run @mint-csv-converter/receipts:ingest -- --store Costco --payer Brian /path/to/receipt.pdf
```

Prints each extracted line item (with its item code, price, and
per-participant split), whether the receipt's numbers reconciled
(subtotal/tax/total arithmetic — a mismatch means the model likely
misread something and this receipt is worth checking against the PDF
by hand), how many items were never seen before, and the aggregate
percentage that would land in the sheet's two "Variably" cells.

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
  total) that flags a receipt as low-confidence without blocking ingest,
  rather than trusting the model's numbers.
- `src/normalizeItemName.ts` / `src/aggregate.ts` — pure helpers (item-name
  fallback key; rolling per-item splits up into the whole-receipt
  aggregate).
- `src/ingest.ts` — the pipeline tying the above together against the
  datastore; `src/scripts/ingest.ts` is its CLI entry.
- `src/snapshot.ts` / `src/restore.ts` — JSON backup/restore.
- `src/testing/testDb.ts` — spins up a real, fully-migrated temp SQLite DB
  for tests (no mocking of the datastore itself).
