# Receipt review editing

## Context

Came out of a `grill-with-docs` session on `packages/receipt-review`'s receipt review page (`ReceiptReviewPage.tsx`) — the same pattern as `receipts-tab-improvements.md`. The design decisions are recorded in [`docs/adr/0009`](docs/adr/0009-line-items-become-fully-editable.md) and [`0010`](docs/adr/0010-receipt-fields-editable-with-printed-total-reference.md), and the glossary in [`CONTEXT.md`](CONTEXT.md) gained **Remove** (line item), **Printed total**, and **Taxable** entries. Read the ADRs for *why*; this file is about *what* and *in what order*.

Starting point: today a reviewer can only rename a line's display name, correct its net price paid, adjust its split, or hard-delete it — every receipt-level field (Store, Payer, purchase date, tax, cardAmount) is extraction-only and never revisited after ingest.

## Commit strategy

Same standing convention as `receipts-tab-improvements.md`: each phase lands as its own commit(s), smaller logical chunks within a phase (schema/migration first, then `packages/receipts` logic, then the server endpoints, then the client) rather than one giant commit per phase. Never commit a failing `nx` lint/typecheck/build/test — a commit is a green checkpoint. No `Co-Authored-By` trailer.

---

## Phase 1 — Line items become fully editable

Implements ADR-0009.

### Schema

- Add `LineItem.taxable Boolean?` and `LineItem.removedAt DateTime?` to `packages/receipts/prisma/schema.prisma`, then `prisma migrate dev --name <description>` from `packages/receipts`.

### `packages/receipts`

- Pull `resolveItem`/`splitPercentsFor` out of `ingest.ts`'s private helpers into a new `itemResolution.ts`, exported publicly with the same signature/behavior (`resolveItem(prisma, storeId, extractedItem, activeParticipants) -> { item, isNew, splitPercents }`) so both `ingest.ts` and the new review-time mutations below can call it. `ingest.ts` imports it instead of defining it inline.
- `ingest.ts`: persist `extractedItem.taxable` into the new `LineItem.taxable` column at `EXTRACTED` time (currently read into `ExtractedLineItem` and discarded).

### `packages/receipt-review/src/server`

- `lineItemReview.ts`:
  - New `addLineItem(prisma, receiptId, input)` — resolves the item via the shared `resolveItem` against the receipt's own `storeId`, creates the `LineItem` + `LineItemSplit` rows (from the resolved `splitPercents`) and a `PriceObservation` dated to the receipt's `purchaseDate`, then calls `recomputeReceiptTotals`.
  - `updateLineItemSplitsSchema`/`updateLineItemSplits` gain `unitPrice`/`quantity`/`taxable` (deferred, batched into the existing PATCH alongside splits/displayName/netPrice) — `unitPrice`/`quantity` edits recompute `lineTotal` and sync the line's existing `PriceObservation`.
  - New `updateLineItemCode(prisma, lineItemId, itemCode)` (immediate, its own endpoint — not part of the batched PATCH) — re-runs `resolveItem` against the receipt's `storeId`, moves the existing `PriceObservation.itemId`, updates `LineItem.itemId`/`rawItemCode`, leaves `LineItemSplit` rows untouched.
  - `deleteLineItem` sets `removedAt` instead of `prisma.lineItem.delete`; new `restoreLineItem(prisma, lineItemId)` clears it. Both call `recomputeReceiptTotals`.
- `receiptTotals.ts`'s `recomputeReceiptTotals`: filter `WHERE removedAt: null` when summing line items.
- `receiptQueries.ts`: `getReceiptDetail` keeps removed lines in `lineItems` (a new `removedAt: string | null` field flags them) instead of excluding them, so the client can render the Restore action; `listReceipts`' `lineItemCount`/aggregate exclude removed lines.
- `app.ts`: `POST /api/receipts/:id/line-items` (add), `PATCH /api/receipts/:id/line-items/:lineItemId/item-code` (immediate re-resolve), `POST /api/receipts/:id/line-items/:lineItemId/restore`; the existing `DELETE .../line-items/:lineItemId` route keeps its shape, now soft-deletes underneath.

### `packages/receipt-review/src/client`

- `ReceiptReviewPage.tsx`: an "Add item" row/button (name, item code, unit price, quantity, taxable — store is implied by the receipt); per-line editable unit price/quantity fields and a taxable checkbox, joining the existing deferred-until-Submit draft state; an item-code field that PATCHes immediately and refreshes `detail` (same pattern `deleteLine` already uses); removed lines rendered struck-through with a Restore button instead of disappearing.

### Verification

- Adding a line item that matches an existing Item inherits its learned split, and its price counts toward that item's price-history on a later receipt.
- Correcting unitPrice/quantity updates lineTotal and shows the corrected price in that item's history hint.
- Correcting an item code to match a different existing Item moves the line's price observation there, and does *not* reset a split the reviewer already adjusted.
- Removing a line item excludes it from the live total; Restore brings it back with its original split/price intact.
- A pre-existing receipt (ingested before `taxable` existed) shows no false taxable/non-taxable state — just unset/unknown.

---

## Phase 2 — Receipt-level fields become editable, with a preserved printedTotal reference

Implements ADR-0010. Depends on Phase 1's shared `resolveItem` export for the Store-change cascade.

### Schema

- Add `Receipt.printedTotal Float?` to `packages/receipts/prisma/schema.prisma`, migrate.

### `packages/receipts`

- `ingest.ts`: persist `extracted.total` into the new `printedTotal` column (alongside the existing `total`) at `EXTRACTED` time.

### `packages/receipt-review/src/server`

- New function (in `receiptMutations.ts` or a new module) `updateReceiptFields(prisma, receiptId, input)`, each field independently optional in the input:
  - `storeId` change: re-resolves every non-removed `LineItem` on the receipt against the new store via Phase 1's shared `resolveItem`, moving each `PriceObservation`, leaving splits untouched — the bulk version of Phase 1's item-code re-resolve.
  - `tax` change: writes it, then `recomputeReceiptTotals`.
  - `purchaseDate` change: writes it, and updates `observedAt` on every `PriceObservation` tied to this receipt's line items to match (they all share one receipt-wide date).
  - `payerId`/`cardAmount`/`printedTotal`: plain field writes.
- `receiptQueries.ts`: `ReceiptDetail` gains `printedTotal: number | null`.
- `app.ts`: new `PATCH /api/receipts/:id` for the fields above — distinct from the existing per-line-item PATCH.

### `packages/receipt-review/src/client`

- `ReceiptReviewPage.tsx`: Store (`Autocomplete`/`freeSolo`) and Payer (`Select`) become editable in the receipt header, matching the Upload page's own field treatment (ADR-0003); purchase date, tax, and cardAmount become editable fields. A live comparison of the current (post-edit) total against `printedTotal` renders a warning `Alert` (same treatment as the existing reconcile/store-mismatch warnings) when they disagree, using `reconcile.ts`'s `RECONCILE_TOLERANCE`.

### Verification

- Editing tax updates the live total immediately, and a printedTotal-mismatch warning appears/disappears as the correction moves toward (or away from) the printed figure.
- Changing Store on a receipt with existing line items re-links every line to Items under the new store, preserving each line's split.
- Overriding cardAmount directly changes what a later Sync attempts to match against the CSV, without touching the underlying `ReceiptTender` rows.
- None of Phase 2's new mismatch signals block Submit.

---

## Notes / assumptions to confirm during build

- Whether `resolveItem`'s new home (`itemResolution.ts`) needs its own `package.json` export subpath (following the `./aggregate`/`./reconcile`/`./storeNameMatch` convention) — decide once it's clear whether `receipt-review` needs it via a subpath import or the main barrel.
- The exact placement/wording of the printedTotal-mismatch warning relative to the existing `reconciled` warning — on a receipt that's *both* unreconciled and printedTotal-mismatched (likely the same underlying problem in practice), two stacked warnings might read as redundant. Worth checking against a real bad extraction once one exists.
- Whether "Add item" needs a store-aware autocomplete over existing item names at that store, or a plain free-text field is good enough to start.
