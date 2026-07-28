# Receipts review UI stays hardcoded to exactly two participants

`ReceiptReviewPage.tsx` represents every line item's split as a single `Slider` (0 = 100% left participant, 100 = 100% right participant), and `resolveNames()` specifically looks for `'Brian'`/`'Patrice'`. This only works for exactly two people, even though the backend data model is already N-ary (`Participant` is a real table, `aggregateSplits`/`splits: Record<string, number>` take an arbitrary list of names).

Decided to keep the Receipts UI's two-participant assumption rather than generalize it: there's no third participant on the horizon, a slider doesn't generalize past two people anyway (an N-participant split needs a different control — per-line percentage inputs or a stacked bar), and building that out speculatively would be designing for a hypothetical this repo's own conventions explicitly avoid. If a third participant is ever added, this page's split control needs a real redesign, not a tweak.
