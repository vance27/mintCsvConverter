import type { Sheet } from './types.js';

/** Value of the "How to split" column for an evenly-split transaction. */
export const SPLIT_TYPE_EQUALLY = 'Equally';
/** Value of the "How to split" column for a percentage-split transaction. */
export const SPLIT_TYPE_VARIABLY = 'Variably';

// Sheet layout — column numbers are 1-indexed, matching Sheets' own
// indexing. Columns after PARTICIPANT_COLUMN_OFFSET hold one column per
// participant (e.g. "Brian", "Patrice"), named by the header row.
export const PAYEE_COLUMN = 2;
export const AMOUNT_COLUMN = 3;
export const SPLIT_TYPE_COLUMN = 4;
export const PARTICIPANT_COLUMN_OFFSET = 4;

/** How many rows (from row 2) to scan when looking for the "TOTAL OWING" marker. */
export const MAX_ROWS_TO_SEARCH = 1000;

export const CHECKBOX_VALIDATION = buildCheckboxValidation();
export const PERCENT_VALIDATION = buildPercentValidation();

/**
 * Builds the data validation rule that renders a cell as a checkbox.
 *
 * @returns A checkbox data validation rule.
 */
export function buildCheckboxValidation(): GoogleAppsScript.Spreadsheet.DataValidation {
  return SpreadsheetApp.newDataValidation().requireCheckbox().build();
}

/**
 * Builds the data validation rule that requires a cell's text to look like
 * a percentage, e.g. "50%".
 *
 * @returns A formula-based data validation rule for percentage strings.
 */
export function buildPercentValidation(): GoogleAppsScript.Spreadsheet.DataValidation {
  const formula =
    '=REGEXMATCH(TO_TEXT(INDIRECT(CONCATENATE("R", TO_TEXT(ROW()), "C", TO_TEXT(COLUMN())), FALSE)), "^\\d+(?:\\.\\d+)?%$")';
  return SpreadsheetApp.newDataValidation().requireFormulaSatisfied(formula).build();
}

/**
 * Scans down column D from row 2 for the literal "TOTAL OWING" marker and
 * returns its row number — 1, used as a computation anchor by the
 * settle-up math (buildDebtMatrix, computeSettlementPayments,
 * writeSettlementPayments all take this same off-by-one value, not the
 * marker's real row number).
 *
 * Deliberately separate from findTotalOwingRowIndex in syncApi.ts, which
 * returns the real row number and is used only to decide where to insert
 * new rows — reusing that value here would be wrong.
 *
 * @param sheet - The sheet to search.
 * @returns The off-by-one row anchor, or `undefined` if no "TOTAL OWING"
 *   row was found — unreachable in normal use, since a real one always
 *   exists; see the `alert` note inside.
 */
export function getTotalRowAnchor(sheet: Sheet): number | undefined {
  const range = sheet.getRange(2, PARTICIPANT_COLUMN_OFFSET, MAX_ROWS_TO_SEARCH, 1);
  const values = range.getValues();
  for (let i = 0; i < values.length; i++) {
    // Relies on JS's array-to-string coercion (a single-element array
    // stringifies to just that element) — preserved exactly as original
    // rather than switched to values[i][0], which is a different (also
    // correct) way to write this but not what the live script does.
    if ((values[i] as unknown) == 'TOTAL OWING') {
      return i + 1;
    }
  }
  // NOTE: `alert` is not a real Apps Script/JS global — preserved as-is
  // from the original rather than "fixed"; this branch is unreachable in
  // normal use since a real "TOTAL OWING" row always exists.
  // @ts-expect-error - see note above
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- see note above
  alert('Could not find total row');
  return undefined;
}

/**
 * Number of participant columns, derived from how far the header row extends.
 *
 * @param sheet - The sheet to inspect.
 * @returns The number of participant columns (e.g. 2 for Brian + Patrice).
 */
export function getParticipantCount(sheet: Sheet): number {
  const lastColumn = sheet.getLastColumn();
  return lastColumn - PARTICIPANT_COLUMN_OFFSET;
}

/**
 * Participant names, read from the header row's participant columns.
 *
 * @param sheet - The sheet to inspect.
 * @returns Participant names in column order, e.g. ["Brian", "Patrice"].
 */
export function getParticipantNames(sheet: Sheet): string[] {
  const participantCount = getParticipantCount(sheet);
  const headerRange = sheet.getRange(1, PARTICIPANT_COLUMN_OFFSET + 1, 1, participantCount);
  return headerRange.getValues()[0] as string[];
}

/**
 * Maps each participant name to its position in the participant column list.
 *
 * @param participantNames - Participant names in column order.
 * @returns A lookup from participant name to column index, e.g. `{ Brian: 0, Patrice: 1 }`.
 */
export function getParticipantIndexByName(participantNames: string[]): Record<string, number> {
  const participantIndexByName: Record<string, number> = {};
  for (let i = 0; i < participantNames.length; i++) {
    participantIndexByName[participantNames[i]] = i;
  }
  return participantIndexByName;
}

/**
 * @param sheet - The sheet containing the row.
 * @param row - The row to check.
 * @returns Whether `row`'s "How to split" value is "Equally".
 */
export function isEquallySplitRow(sheet: Sheet, row: number): boolean {
  const range = sheet.getRange(row, SPLIT_TYPE_COLUMN);
  const val = range.getValue() as string;
  return val == SPLIT_TYPE_EQUALLY;
}

/**
 * @param sheet - The sheet containing the row.
 * @param row - The row to check.
 * @returns Whether `row`'s "How to split" value is "Variably".
 */
export function isVariablySplitRow(sheet: Sheet, row: number): boolean {
  const range = sheet.getRange(row, SPLIT_TYPE_COLUMN);
  const val = range.getValue() as string;
  return val == SPLIT_TYPE_VARIABLY;
}

/**
 * @param sheet - The sheet containing the row.
 * @param row - The row to check.
 * @param participantCount - How many participant columns to scan.
 * @returns How many participant checkboxes are checked (true) on an equally-split row.
 */
export function countEquallySplitParticipants(sheet: Sheet, row: number, participantCount: number): number {
  let count = 0;
  for (let i = 0; i < participantCount; i++) {
    const col = PARTICIPANT_COLUMN_OFFSET + i + 1;
    const range = sheet.getRange(row, col);
    const val = range.getValue() as boolean;
    if (val == true) {
      count++;
    }
  }
  return count;
}

/**
 * @param sheet - The sheet containing the row.
 * @param row - The row to sum.
 * @param participantCount - How many participant columns to scan.
 * @returns Sum of the participant-column share values on a variably-split row (should total ~100).
 */
export function sumVariableSplitShares(sheet: Sheet, row: number, participantCount: number): number {
  let total = 0;
  for (let i = 0; i < participantCount; i++) {
    const col = PARTICIPANT_COLUMN_OFFSET + i + 1;
    const range = sheet.getRange(row, col);
    const val = range.getValue() as number;
    total += val;
  }
  return total;
}

/**
 * @param sheet - The sheet to read.
 * @param totalRowAnchor - The off-by-one anchor from getTotalRowAnchor.
 * @returns The "Who Paid" (payee) name for every transaction row, from row
 *   2 up to the settle-up anchor, in row order.
 */
export function getPayeeNamesForRows(sheet: Sheet, totalRowAnchor: number): string[] {
  const payeeRange = sheet.getRange(2, PAYEE_COLUMN, totalRowAnchor - 1, 1);
  const payeeValues = payeeRange.getValues() as string[][];
  const payeeNames: string[] = [];
  for (let i = 0; i < payeeValues.length; i++) {
    payeeNames.push(payeeValues[i][0]);
  }
  return payeeNames;
}
