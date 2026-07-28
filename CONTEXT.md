# mintCsvConverter

A tool for converting a household's Citi credit card export into per-transaction expense splits, reviewing Costco/Target receipts to derive item-level splits, and pushing both into a shared Google Sheet.

## Language

**Participant**:
One of the two people (Brian, Patrice) whose expenses are split. Modeled as a real DB row (`Participant`) so the *data* layer is N-ary, but the Receipts review UI is intentionally hardcoded to exactly these two — see [ADR-0001](docs/adr/0001-receipts-ui-stays-two-participant.md).
_Avoid_: User, payer (payer is a narrower, related-but-different concept — the participant who paid the card, not one of the two split parties)

**Split**:
The percentage of a line item or transaction's cost attributed to each Participant. Always expressed as a `Record<participantName, percent>` that sums to 100.
_Avoid_: Share, allocation

**Cancel** (receipt):
A user action that stops an in-flight (`QUEUED`/`EXTRACTING`) receipt, moving it to the terminal `CANCELLED` status. Distinct from `FAILED`, which means extraction itself errored out rather than being deliberately stopped. See [ADR-0002](docs/adr/0002-cancelled-status-and-receipt-delete.md).
_Avoid_: Stop, abort

**Delete** (receipt):
A hard removal of a receipt in a terminal, non-submitted status (`FAILED` or `CANCELLED` only — never `SUBMITTED`, `QUEUED`, or `EXTRACTING`). Removes the DB row and its retained source PDF from disk. See [ADR-0002](docs/adr/0002-cancelled-status-and-receipt-delete.md).
_Avoid_: Remove, discard

**Payer** (receipt):
The Participant whose card the receipt's charge is on. A closed set — always one of the same active Participants used for splits, never free text. See [ADR-0003](docs/adr/0003-receipt-upload-store-and-payer-fields.md).
_Avoid_: Buyer, cardholder

**Store** (receipt):
The vendor a receipt belongs to. Must match, as a substring, a `VariableSplitRule.pattern` (see Settings tab) for the receipt to ever be matchable to its Citi transaction during Sync — a Store name with no corresponding rule means "unmatchable," not just "uncategorized." Declared by the user at upload time (before extraction), since it also selects which VLM extraction prompt runs — not to be confused with the store name the VLM itself reads off the receipt image, which is a separate, informational cross-check (see [ADR-0004](docs/adr/0004-extracted-store-reconciliation.md)).
_Avoid_: Vendor, merchant (used interchangeably in prose, but Store is the canonical term)

**Model** (receipt):
The Ollama vision-language model (e.g. `qwen2.5vl:32b`) used to extract a receipt, chosen per-upload rather than fixed globally for the whole server. Part of the row's uniqueness alongside its source PDF's content hash, so the same physical receipt can be deliberately re-ingested under a different model to compare extraction quality — each becomes its own ordinary Receipt row, reviewed side by side in the normal queue. See [ADR-0007](docs/adr/0007-per-upload-model-selection.md).
_Avoid_: Engine, VLM (VLM is fine in prose for "vision-language model" generically, but Model is the field/column name)

**Remove** (line item):
A *soft* delete of one `LineItem` — sets `removedAt`, excluded from totals/aggregates, but stays in the DB and is shown struck-through with a Restore action rather than disappearing. Deliberately distinct from receipt-level **Delete**, which stays a hard, unrecoverable removal (see above) — the two operate at different granularity and different reversibility on purpose. See [ADR-0009](docs/adr/0009-line-items-become-fully-editable.md).
_Avoid_: Delete (reserved for the receipt-level hard removal)

**Printed total**:
`Receipt.printedTotal` — the VLM's original `total` reading, preserved separately from the now fully-derived `Receipt.total` (which is recomputed from the current line items + tax on every edit). Exists so a reviewer's live corrections can still be checked against what the receipt actually printed, rather than the only ground-truth figure getting silently overwritten by the first edit. Itself directly correctable, for the case where the VLM misread that specific digit. See [ADR-0010](docs/adr/0010-receipt-fields-editable-with-printed-total-reference.md).
_Avoid_: Extracted total, original total (printed total is the field/column name)

**Taxable** (line item):
Whether an item was taxed, per its printed receipt flag (Costco prints a trailing Y/N per line). Extracted by the VLM and persisted as `LineItem.taxable`, editable in review — record-keeping only for now, not used in any computed tax cross-check. See [ADR-0009](docs/adr/0009-line-items-become-fully-editable.md).
