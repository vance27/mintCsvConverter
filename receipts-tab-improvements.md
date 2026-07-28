# Receipts tab improvements

## Context

Came out of a `grill-with-docs` session auditing `packages/receipt-review`'s Receipts tab (`ReviewQueuePage`/`UploadPage`/`ReceiptReviewPage`/`SubmittedPage`). The design decisions are recorded in [`CONTEXT.md`](CONTEXT.md) and [`docs/adr/0001`](docs/adr/0001-receipts-ui-stays-two-participant.md) through [`0008`](docs/adr/0008-widen-deletable-receipt-statuses-to-extracted.md) — this document turns those into an actual build plan. Read the ADRs for *why*; this file is about *what* and *in what order*.

Not in scope here: ADR-0001 (stay 2-participant) is a decision *not* to build anything — no phase below touches it.

## Commit strategy

Same standing convention as `costco-receipt-importer.md`: each phase lands as its own commit(s), smaller logical chunks within a phase (schema/migration first, then backend logic, then endpoint, then UI) rather than one giant commit per phase. Never commit a failing `nx` lint/typecheck/build/test — a commit is a green checkpoint. No `Co-Authored-By` trailer.

---

## Phase 1 — Receipt lifecycle: CANCELLED status, widened delete, elapsed-time counter

Implements ADR-0002 and ADR-0008 together as one end-state (no point building the narrower FAILED/CANCELLED-only delete scope first and widening it immediately after — see ADR-0002's amendment note).

### Schema

- `packages/receipts/prisma/schema.prisma`: add `CANCELLED` to `ReceiptStatus`. Turned out not to need an actual migration — SQLite has no native enum type, so Prisma represents `ReceiptStatus` as a plain `TEXT` column with no `CHECK` constraint; `prisma migrate dev` reported "already in sync." Just `prisma generate` to pick up the new value in the generated TS enum.

### `packages/receipts`

- `receiptStateMachine.ts`: `canRetry` stays `FAILED | CANCELLED` (both already retryable per ADR-0002's "both actions for both statuses" decision — `CANCELLED` needs adding to its current `FAILED`-only check). Add a new predicate (e.g. `isDeletable`) covering `FAILED | CANCELLED | EXTRACTED` — everything except `QUEUED`, `EXTRACTING`, `SUBMITTED`.
- `uploadQueue.ts`'s `cancel()`: set status to `CANCELLED` instead of reusing `FAILED` with `CANCELLED_MESSAGE`. The `extractionError` field is no longer needed for cancellation (it's a `FAILED`-only concept now) — confirm nothing else reads `extractionError` on a `CANCELLED` row expecting the old message.
- `uploadQueue.ts`'s `retry()`: currently `updateMany({ where: { status: 'FAILED' } ...})` — widen to `status: { in: ['FAILED', 'CANCELLED'] }` so retry actually works from both, per ADR-0002.

### `packages/receipt-review/src/server`

- New `deleteReceipt(prisma, receiptId)` (same module shape as `lineItemReview.ts`'s existing `deleteLineItem` — a plain function, not a class): validate `isDeletable(receipt.status)` (throw/400 otherwise), `prisma.receipt.delete(...)` (cascade already handles `LineItem`/`LineItemSplit`/`ReceiptTender`/`PriceObservation` per the schema's existing `onDelete: Cascade`), then `unlinkSync(receipt.sourcePath)`.
- `app.ts`: new `DELETE /api/receipts/:id`.

### `packages/receipt-review/src/client`

- `ReviewQueuePage.tsx`: add a Delete action (icon + confirm dialog — reuse the "This can't be undone" `Dialog` pattern already in `ReceiptReviewPage.tsx`'s line-item delete) for any row where `isDeletable` is true. `STATUS_PRIORITY` and `ReviewIndicator` need a `CANCELLED` case (its own icon/tooltip, distinct from `FAILED`'s `ErrorIcon`).
- Same page: add a plain elapsed-time counter ("Extracting… 47s elapsed") to the `EXTRACTING` row — no ADR (reversible, not surprising), just a small addition since it's the same component being touched.

### Verification

- Cancel a `QUEUED` and an `EXTRACTING` receipt — both land on `CANCELLED`, not `FAILED`.
- Retry works from both `FAILED` and `CANCELLED`.
- Delete works from `FAILED`, `CANCELLED`, and `EXTRACTED`; rejected (400) from `QUEUED`, `EXTRACTING`, `SUBMITTED`.
- Deleting an `EXTRACTED` receipt removes its retained PDF file from `~/.config/mint-csv-converter/receipts/`.

---

## Phase 2 — Persist and surface reconcile deltas

Implements ADR-0006.

### Schema

- Add a JSON column to `Receipt` for the full `ReconcileResult` (simpler than one column per delta, per the ADR).

### `packages/receipts`

- `ingest.ts`: persist the whole `reconcileResult` (not just `.reconciled`) into the new column when a receipt lands on `EXTRACTED`.

### `packages/receipt-review/src/server`

- `receiptQueries.ts`'s `ReceiptDetail`/`getReceiptDetail`: include the parsed reconcile detail.

### `packages/receipt-review/src/client`

- `ReceiptReviewPage.tsx`: replace the generic "⚠ low confidence — check carefully against the PDF" text with a specific message built from whichever delta(s) are out of tolerance (e.g. "total is $4.37 higher than line items + tax").

### Verification

- A receipt that fails `subtotalDelta`/`totalDelta`/`tenderDelta` shows the specific mismatch, not just the generic warning.
- A reconciled receipt shows no warning, unchanged from today.

---

## Phase 3 — Extracted-store reconciliation

Implements ADR-0004. Independent of Phase 2 but touches the same review-page warning area — fine to land in either order relative to Phase 2, just not truly parallel work on `ReceiptReviewPage.tsx`.

### Schema

- Add a nullable `extractedStoreName` column to `Receipt`.

### `packages/receipts`

- `ingest.ts`: persist `extracted.store` (currently read into the extraction result and discarded) into the new column.

### `packages/receipt-review/src/server`

- `receiptQueries.ts`: include `extractedStoreName` in `ReceiptDetail`.

### `packages/receipt-review/src/client`

- `ReceiptReviewPage.tsx`: warning when `extractedStoreName` disagrees with the declared `store` (case-insensitive; decide during build whether substring or exact-ish comparison is the right check — receipts don't always print the exact same string as the declared Store name).

### Verification

- A receipt whose printed store text disagrees with the declared Store shows a warning naming both values.
- A receipt where the VLM couldn't read a store name (`null`) shows no warning (no false positive).

---

## Phase 4 — Model column + comparison backend

Implements the backend half of ADR-0007. Much of the plumbing already exists: `VisionChatClient.chat()`, `extractReceipt`'s `ExtractReceiptOptions.model`, and `IngestOptions.model` are all already threaded through to the actual Ollama call — this phase is schema + the two places that still ignore `model` (the uniqueness key and persistence), plus a way to list installed models.

### Schema

- Add a `model` column to `Receipt` (not nullable — always set, defaulting to `defaultOllamaModel()`'s current env-based value at ingest time).
- Change the unique constraint from `sourceSha256` alone to `(sourceSha256, model)`.

### `packages/receipts`

- `ingest.ts`'s `queueReceiptForIngest`: the existing-lookup (`prisma.receipt.findUnique`) keys on `(sourceSha256, model)` instead of `sourceSha256` alone; persist `model` when creating the `Receipt` row.
- New small function to list installed Ollama models (thin wrapper over Ollama's `/api/tags`, same narrow-interface-for-testability pattern as `VisionChatClient`).

### `packages/receipt-review/src/server`

- New `GET /api/ollama-models` (or similar) backed by the function above.
- `receiptQueries.ts`: include `model` in `ReceiptSummary`/`ReceiptDetail` so both queue and review views can show which model produced a given receipt.

### Verification

- Uploading the same PDF bytes under a model that hasn't been tried yet creates a second `Receipt` row.
- Uploading the same PDF bytes under a model that's already been tried reuses the existing row, same as today.
- `GET /api/ollama-models` returns the locally installed models.

---

## Phase 5 — Upload page rebuild: file-first editable table

Implements ADR-0003 and ADR-0005, plus the UI half of ADR-0007 (Model column) — bundled together since all three land as edits to the same page and the same upload endpoint, not because they're one decision.

### `packages/receipt-review/src/server`

- New `GET /api/participants` (doesn't exist yet — needed for the Payer `Select`; `/api/variable-split-rules` already exists and is reused as-is for Store `Autocomplete` suggestions).
- `app.ts`'s `POST /api/uploads`: contract changes from one shared `store`/`payer` for the whole request to per-file `store`/`payer`/`model` (e.g. indexed form fields, or switch the endpoint to accept a JSON manifest alongside the files). `uploadQueue.enqueue` already takes `{ store, payer }` per call in the `files.map(...)` — just needs `model` added and the per-file values threaded through instead of the two closed-over shared constants.

### `packages/receipt-review/src/client`

- `UploadPage.tsx` rewritten: pick files first (file input stays `multiple` — confirmed each file is always its own distinct receipt, never split pages), then an editable table (columns: filename, Store `Autocomplete`/`freeSolo`, Payer `Select`, Model `Select`), each row defaulting to the last-used values (sticky, `localStorage`), nothing queued until an explicit submit button. Store suggestions from `/api/variable-split-rules`, Payer options from the new `/api/participants`, Model options from Phase 4's `/api/ollama-models`.

### Verification

- Selecting N files shows N editable rows, each independently editable.
- Submitting queues N receipts with their own per-row store/payer/model.
- A second upload session's rows default to the previous session's last-used values, not hardcoded `'Costco'`/`'Brian'`.
- A batch mixing stores (e.g. one Costco + one Target file) queues both correctly with their own prompts.

---

## Notes / assumptions to confirm during build

- Phase 3's store-mismatch comparison (substring vs. exact-ish) needs a real receipt sample to tune — don't guess at the right fuzziness upfront.
- Phase 5's `POST /api/uploads` contract change is the one real breaking API change in this plan — check nothing else calls that endpoint before changing its shape.
- The elapsed-time counter (Phase 1) has no ADR and no strong opinion on exact implementation (client-side `setInterval` off `createdAt`/extraction-start timestamp vs. something server-reported) — whichever is simplest.
