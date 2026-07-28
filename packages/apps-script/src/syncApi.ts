import { onSplitTypeChanged } from './triggers.js';
import { applyRowPercentages } from './sheetLayout.js';
import { recalculateSettleUp } from './settleUp.js';

// ---------------------------------------------------------------------
// This file is new: an Apps Script API entry point (called via
// `scripts.run`, deployed as an "API Executable" with access "MYSELF" —
// see appsscript.json's executionApi) so packages/automation can finish
// applying this sheet's checkbox/percent defaulting and settle-up
// recalculation to rows it has already written via the Sheets API,
// without needing to reimplement that math in TypeScript.
// ---------------------------------------------------------------------

/**
 * Applies checkbox/percent defaulting (via onSplitTypeChanged) and
 * recalculates the settle-up summary for a contiguous block of rows that
 * packages/automation has already inserted into `sheetName` via the
 * Sheets API. Row-insertion mechanics (finding/creating the sheet,
 * finding the insertion point, writing raw values) intentionally live in
 * packages/automation, not here — the Sheets API is the right tool for
 * that; this function only does the part that requires this sheet's own
 * Apps Script logic.
 *
 * @param sheetName - The target tab's name, e.g. "Brian 07/26".
 * @param startRow - The first inserted row's 1-indexed row number.
 * @param rowCount - How many contiguous rows starting at startRow to finalize.
 * @param rowPercentages - Per-row receipt-manifest-matched percentages,
 *   aligned 1:1 with the rowCount rows starting at startRow (see
 *   AddTransactionsRequest.rowPercentages in packages/automation's
 *   sheetsClient.ts). For a row with a real match, its percentages are
 *   written directly instead of onSplitTypeChanged's even default; null
 *   entries (or omitting this parameter) keep today's default-fill
 *   behavior.
 * @throws If no sheet named `sheetName` exists.
 */
export function finalizeAddedRows(
    sheetName: string,
    startRow: number,
    rowCount: number,
    rowPercentages?: (Record<string, number> | null)[] | null,
): void {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found`);
    }

    for (let i = 0; i < rowCount; i++) {
        const percentages = rowPercentages?.[i];
        if (!percentages || !applyRowPercentages(sheet, startRow + i, percentages)) {
            onSplitTypeChanged(sheet, startRow + i);
        }
    }

    recalculateSettleUp(sheet);
}
