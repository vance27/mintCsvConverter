import type { TransactionRow } from '@mint-csv-converter/core';
import type { ManifestEntry } from '@mint-csv-converter/receipt-manifest';
import { toIsoDate } from './dateUtils.js';

// Rounding-error tolerance between a Citi CSV amount and a receipt's
// cardAmount — both are decimal dollars, so a cent of float slop is enough.
const AMOUNT_TOLERANCE = 0.01;

// convertToExpenseSplitting bundles description + date into row[0] as
// "<description> MM/DD/YYYY" (see csvConverterFactory.ts's
// `${line[1]} ${line[0]}`) — the date is always well-formed by this point
// (groupRowsByPeriod already validated it via getPeriodLabel earlier in the
// sync pipeline), so splitting on the trailing date is safe.
const DESCRIPTION_DATE_PATTERN = /^(.*) (\d{2}\/\d{2}\/\d{4})$/;

function splitDescriptionAndDate(value: string): { description: string; date: string } {
  const match = DESCRIPTION_DATE_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Expected "<description> MM/DD/YYYY", got: ${value}`);
  }
  return { description: match[1], date: match[2] };
}

/**
 * Matches a 'Variably' TransactionRow (post-convertToExpenseSplitting)
 * against the receipt manifest, so sync can pre-fill real per-participant
 * percentages instead of the '%'/'%' placeholder. Amount-primary: the
 * VARIABLE vendor list entries ('Costco', 'TARGET') already equal the
 * manifest's store names, so filtering candidates to entries whose store
 * name appears in the row's description is a correct, cheap first cut, not
 * a coincidence. Returns null (never throws on a no-match) when there's no
 * confident match, so an unmatched row just falls back to today's
 * placeholder behavior — this must never block a sync.
 */
export function matchManifestEntry(
  row: TransactionRow,
  payerName: string,
  entries: ManifestEntry[],
): Record<string, number> | null {
  const { description, date } = splitDescriptionAndDate(row[0]);
  const amount = Number.parseFloat(row[2]);

  const candidates = entries.filter(
    (entry) =>
      entry.payer.toLowerCase() === payerName.toLowerCase() &&
      description.toLowerCase().includes(entry.store.toLowerCase()) &&
      Math.abs(amount - entry.cardAmount) <= AMOUNT_TOLERANCE,
  );

  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0].percentages;
  }

  // Multiple receipts at the same store, same day, same amount — tiebreak
  // on whichever purchaseDate is closest to the transaction's date.
  const transactionMs = Date.parse(toIsoDate(date));
  const closest = candidates.reduce((best, entry) => {
    const bestDelta = Math.abs(Date.parse(best.purchaseDate) - transactionMs);
    const entryDelta = Math.abs(Date.parse(entry.purchaseDate) - transactionMs);
    return entryDelta < bestDelta ? entry : best;
  });
  return closest.percentages;
}
