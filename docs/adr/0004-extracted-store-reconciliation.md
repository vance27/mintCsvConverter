# Persist the VLM's own store reading, and warn on mismatch rather than re-extracting

`extractReceipt.ts`'s extraction schema already includes `store: z.string().nullable()` — the VLM reads a store name directly off the receipt image — but `ingest.ts` never used it for anything; it was extracted and silently discarded. Meanwhile `buildExtractionPrompt(store)` selects between a Costco-tuned prompt and a generic one based entirely on the user-declared Store field from the Upload form, chosen *before* extraction runs. A wrong declared Store (stale default, typo, wrong pick in a multi-file batch) means the wrong prompt gets used, and nothing ever catches it.

Considered re-detecting the store first and extracting with the correct prompt in a second pass, but rejected it: each extraction pass takes ~130-170s, so a two-pass flow would roughly double the slowest part of the whole pipeline for a mismatch that, in practice, should be rare.

Decided instead to persist the VLM's own `store` reading (rather than discard it) and surface a warning in `ReceiptReviewPage` when it disagrees with the declared Store — free, since the data is already produced by the single extraction pass, and it directly catches the failure mode a wrong declared Store would otherwise hide until the numbers looked off much later (or forever, if the receipt is never cross-checked against its source PDF).
