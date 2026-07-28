# Persist reconcile() deltas instead of just the boolean

`reconcile.ts` already computes exactly which arithmetic check failed and by how much (`subtotalDelta`, `totalDelta`, `tenderDelta`), but `ingest.ts` only ever persists the single `reconciled: Boolean` column — the deltas are computed, used for the one true/false verdict, and discarded. A reviewer facing a low-confidence receipt today has no more information than "something's off," and has to redo the same arithmetic by eye against the source PDF that the system already did precisely.

Decided to persist the full `ReconcileResult` (as JSON on `Receipt`, simpler than one column per delta) and surface the specific mismatch in `ReceiptReviewPage`'s low-confidence warning — e.g. "total is $4.37 higher than line items + tax" instead of a generic "check carefully against the PDF." Same rationale as [ADR-0004](0004-extracted-store-reconciliation.md): the data already exists for free: only the "keep and show it" step was missing.
