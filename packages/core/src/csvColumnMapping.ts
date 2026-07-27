import type { TransactionRow } from './csvConverterFactory.js';

/** Locates a column either by header name (case-insensitive, order-independent — resilient to a bank reordering its export columns) or by fixed position (for headerless CSVs). */
export type ColumnRef = { byName: string } | { byIndex: number };

export type AmountExtraction =
  | { mode: 'DEBIT_CREDIT'; debitColumn: ColumnRef; creditColumn: ColumnRef }
  | { mode: 'SIGNED_AMOUNT'; amountColumn: ColumnRef; flipSign: boolean };

/** Describes how to turn an arbitrary CSV's raw grid into the [date, description, '', amount] shape the rest of the pipeline expects. */
export interface CsvColumnMapping {
  hasHeader: boolean;
  dateColumn: ColumnRef;
  descriptionColumn: ColumnRef;
  amount: AmountExtraction;
}

/** Reproduces today's hardcoded ImportFileToLines behavior exactly: Citi's [Status, Date, Description, Debit, Credit, Member Name] layout, located by case-insensitive header name. */
export const CITI_DEFAULT_MAPPING: CsvColumnMapping = {
  hasHeader: true,
  dateColumn: { byName: 'date' },
  descriptionColumn: { byName: 'description' },
  amount: {
    mode: 'DEBIT_CREDIT',
    debitColumn: { byName: 'debit' },
    creditColumn: { byName: 'credit' },
  },
};

// Discarded by CsvConverterFactory.convertToExpenseSplitting (it always
// skips index 0) — contents don't matter beyond providing a placeholder
// row to skip, for CSVs that don't actually have a header row.
const HEADERLESS_PLACEHOLDER_ROW: TransactionRow = ['', '', '', ''];

function labelFor(ref: ColumnRef): string {
  if ('byName' in ref) {
    return ref.byName.charAt(0).toUpperCase() + ref.byName.slice(1);
  }
  return `column ${ref.byIndex}`;
}

function joinWithAnd(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function resolveColumnIndex(ref: ColumnRef, header: string[] | null): number | undefined {
  if ('byIndex' in ref) return ref.byIndex;
  if (header === null) return undefined;
  const index = header.indexOf(ref.byName.trim().toLowerCase());
  return index === -1 ? undefined : index;
}

function requiredRefs(mapping: CsvColumnMapping): ColumnRef[] {
  return mapping.amount.mode === 'DEBIT_CREDIT'
    ? [mapping.dateColumn, mapping.descriptionColumn, mapping.amount.debitColumn, mapping.amount.creditColumn]
    : [mapping.dateColumn, mapping.descriptionColumn, mapping.amount.amountColumn];
}

// Debit is a charge (positive). Credit covers both card payments (excluded
// separately via personalExclusions, e.g. "ONLINE PAYMENT, THANK YOU") and
// genuine merchant refunds — both appear as negative Credit values in Citi's
// export. The sign is preserved rather than forced positive, so a refund
// that passes validity checks still shows up as a negative amount instead
// of looking like an ordinary positive charge.
function normalizeDebitCredit(debit: string | undefined, credit: string | undefined): string {
  const raw = debit && debit.trim() !== '' ? debit : credit;
  if (raw === undefined || raw.trim() === '') {
    return '';
  }
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) {
    return raw;
  }
  return value.toFixed(2);
}

function normalizeSignedAmount(raw: string | undefined, flipSign: boolean): string {
  if (raw === undefined || raw.trim() === '') {
    return '';
  }
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) {
    return raw;
  }
  return (flipSign ? -value : value).toFixed(2);
}

/** Applies a CsvColumnMapping to a raw parsed CSV grid, producing the [date, description, '', amount] rows the rest of core/automation/receipt-review expect — with a placeholder row 0 to skip when the CSV has no real header. */
export function applyColumnMapping(rawRows: string[][], mapping: CsvColumnMapping): TransactionRow[] {
  if (rawRows.length === 0) {
    return rawRows;
  }

  const header = mapping.hasHeader ? rawRows[0].map((cell) => cell.trim().toLowerCase()) : null;
  const refs = requiredRefs(mapping);
  const indexes = refs.map((ref) => resolveColumnIndex(ref, header));

  if (indexes.some((index) => index === undefined)) {
    const labels = refs.map(labelFor);
    const noun = labels.length > 1 ? 'columns' : 'column';
    throw new Error(`Expected a header row containing ${joinWithAnd(labels)} ${noun}; got: ${rawRows[0].join(', ')}`);
  }

  const dateIndex = resolveColumnIndex(mapping.dateColumn, header) as number;
  const descriptionIndex = resolveColumnIndex(mapping.descriptionColumn, header) as number;

  const dataRows = mapping.hasHeader ? rawRows.slice(1) : rawRows;
  const normalized: TransactionRow[] = [mapping.hasHeader ? rawRows[0] : HEADERLESS_PLACEHOLDER_ROW];

  for (const row of dataRows) {
    const date = row[dateIndex] ?? '';
    const description = row[descriptionIndex] ?? '';
    const amount =
      mapping.amount.mode === 'DEBIT_CREDIT'
        ? normalizeDebitCredit(
            row[resolveColumnIndex(mapping.amount.debitColumn, header) as number],
            row[resolveColumnIndex(mapping.amount.creditColumn, header) as number],
          )
        : normalizeSignedAmount(row[resolveColumnIndex(mapping.amount.amountColumn, header) as number], mapping.amount.flipSign);
    normalized.push([date, description, '', amount]);
  }
  return normalized;
}
