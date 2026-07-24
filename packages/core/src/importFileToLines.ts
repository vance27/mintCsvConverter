import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

/**
 * Citi's export has columns [Status, Date, Description, Debit, Credit,
 * Member Name] — not the [Date, Description, ..., Amount] shape the
 * conversion logic expects. This normalizes each row to
 * [date, description, '', amount] by locating Date/Description/Debit/Credit
 * by header name (case-insensitive), so a header reorder in a future export
 * doesn't silently break amount/description matching.
 */
export class ImportFileToLines {
  constructor(private readonly file: string) {}

  getResults(): string[][] {
    console.log('Importing file, converting to lines');
    const content = readFileSync(this.file, 'utf-8');
    const rows = parse(content) as string[][];
    if (rows.length === 0) {
      return rows;
    }

    const header = rows[0]!.map((cell) => cell.trim().toLowerCase());
    const dateIndex = header.indexOf('date');
    const descriptionIndex = header.indexOf('description');
    const debitIndex = header.indexOf('debit');
    const creditIndex = header.indexOf('credit');

    if (dateIndex === -1 || descriptionIndex === -1 || debitIndex === -1 || creditIndex === -1) {
      throw new Error(
        `Expected a header row containing Date, Description, Debit, and Credit columns; got: ${rows[0]!.join(', ')}`,
      );
    }

    const normalized: string[][] = [rows[0]!];
    for (const row of rows.slice(1)) {
      const date = row[dateIndex] ?? '';
      const description = row[descriptionIndex] ?? '';
      const amount = normalizeAmount(row[debitIndex], row[creditIndex]);
      normalized.push([date, description, '', amount]);
    }
    return normalized;
  }
}

// Debit is a charge (positive). Credit covers both card payments (excluded
// separately via personalExclusions, e.g. "ONLINE PAYMENT, THANK YOU") and
// genuine merchant refunds — both appear as negative Credit values in Citi's
// export. The sign is preserved rather than forced positive, so a refund
// that passes validity checks still shows up as a negative amount instead
// of looking like an ordinary positive charge.
function normalizeAmount(debit: string | undefined, credit: string | undefined): string {
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
