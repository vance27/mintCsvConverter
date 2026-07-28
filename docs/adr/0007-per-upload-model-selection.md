# Model becomes a per-upload field, and doubles as a way to compare models on the same receipt

The Ollama model used for extraction was previously fixed once at server startup via `OLLAMA_MODEL`, even though `VisionChatClient.chat()`'s interface already took `model` per-call — nothing varied it. `defaultOllamaModel()`'s own doc comment already records real evidence that model choice matters: `qwen2.5vl:7b` misattributed a quantity annotation on a real receipt that `qwen2.5vl:32b` got right, at the cost of ~28GB RAM and ~130-170s vs. a few seconds.

Decided: Model becomes a real column on `Receipt`, chosen per-upload (same editable-table pattern as Store/Payer in [ADR-0005](0005-upload-page-file-first-with-editable-table.md)), sourced from Ollama's own `/api/tags`, defaulting to the current `OLLAMA_MODEL` env value.

This also unlocks running the same physical receipt through two different models to compare extraction quality, without inventing a new "extraction attempt" concept: the uniqueness constraint on `Receipt` moves from `sourceSha256` alone to `(sourceSha256, model)`, and `queueReceiptForIngest`'s existing-by-hash lookup keys on that same pair. Uploading identical PDF bytes under a different Model than any existing row simply creates a second, ordinary `Receipt` — same content, different model, both independently reviewable side by side in the normal queue table, with zero new UI. Re-uploading identical bytes under a model that's already been tried still reuses the existing row, exactly as today.

See [ADR-0008](0008-widen-deletable-receipt-statuses-to-extracted.md) for the delete-scope change this comparison workflow required.
