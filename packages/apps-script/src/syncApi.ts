import type { AddTransactionsPayload, AddTransactionsResult, Sheet, Spreadsheet } from './types.js';
import { MAX_ROWS_TO_SEARCH, PARTICIPANT_COLUMN_OFFSET } from './sheetLayout.js';
import { onSplitTypeChanged } from './triggers.js';
import { recalculateSettleUp } from './settleUp.js';

// ---------------------------------------------------------------------
// This file is new: an HTTP entry point so the sync tooling in
// packages/automation can push rows into this sheet the same way a manual
// paste + dropdown selection would, without needing to reimplement the
// checkbox/percent defaulting or the settle-up math in sheetLayout.ts /
// settleUp.ts in TypeScript.
// ---------------------------------------------------------------------

/** Script Properties key holding the shared secret doPost checks incoming requests against. */
export const SYNC_TOKEN_PROPERTY_KEY = 'SYNC_TOKEN';

/**
 * Web App entry point (deploy as "Execute as: Me", "Who has access: Anyone
 * with the link"). Expects a JSON POST body:
 *   { token: string, payerName: string, periodLabel: string, rows: string[][] }
 * where each row is [description, payerName, amount, splitType] (matching
 * columns A-D; columns E onward are recomputed by onSplitTypeChanged,
 * not supplied by the caller).
 *
 * Apps Script Web Apps always return HTTP 200 regardless of what happens
 * inside doPost — there is no API to set a different status code — so
 * callers must check the `ok` field in the JSON response body, not the
 * HTTP status.
 *
 * @param e - The Web App POST event; `e.postData.contents` holds the raw JSON body.
 * @returns A JSON response: `{ ok: true, result }` on success, or
 *   `{ ok: false, error }` on failure (bad token, bad payload, or a thrown error).
 */
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    const payload = JSON.parse(e.postData.contents) as AddTransactionsPayload;

    const expectedToken = PropertiesService.getScriptProperties().getProperty(SYNC_TOKEN_PROPERTY_KEY);
    if (!expectedToken || payload.token !== expectedToken) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    if (!payload.payerName || !payload.periodLabel || !Array.isArray(payload.rows)) {
      return jsonResponse({ ok: false, error: 'Expected { token, payerName, periodLabel, rows }' });
    }

    const result = addTransactionsForPeriod(payload.payerName, payload.periodLabel, payload.rows);
    return jsonResponse({ ok: true, result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Wraps a value as a JSON HTTP response body for a Web App request.
 *
 * @param body - The value to serialize as the response body.
 * @returns A `TextOutput` with `application/json` content type.
 */
export function jsonResponse(body: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Finds (or creates, by duplicating the "DUPLICATE ME" template — which
 * preserves all formatting/validation/conditional formatting exactly like
 * clicking "Duplicate" would) the "<payerName> <periodLabel>" sheet, appends
 * `rows` just above the "TOTAL OWING" marker, applies the same
 * checkbox/percent defaulting a manual dropdown selection would via the
 * existing onSplitTypeChanged, then recalculates the settle-up summary via
 * the existing recalculateSettleUp().
 *
 * @param payerName - Who paid, e.g. "Brian" — determines the target tab's name.
 * @param periodLabel - The billing period, e.g. "07/26" — the rest of the target tab's name.
 * @param rows - Each row is [description, payerName, amount, splitType] (columns A-D).
 * @returns The target sheet's name and how many rows were added.
 */
export function addTransactionsForPeriod(payerName: string, periodLabel: string, rows: string[][]): AddTransactionsResult {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = payerName + ' ' + periodLabel;
  const sheet = findOrCreateSheet(spreadsheet, sheetName);

  if (rows.length === 0) {
    return { sheetName, rowsAdded: 0 };
  }

  const insertRow = findTotalOwingRowIndex(sheet);
  sheet.insertRowsBefore(insertRow, rows.length);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    sheet.getRange(insertRow + i, 1, 1, row.length).setValues([row]);
    onSplitTypeChanged(sheet, insertRow + i);
  }

  recalculateSettleUp(sheet);

  return { sheetName, rowsAdded: rows.length };
}

/**
 * Looks up `sheetName` in `spreadsheet`, or creates it by duplicating the
 * "DUPLICATE ME" template sheet (preserving its formatting/validation)
 * and renaming the copy.
 *
 * @param spreadsheet - The spreadsheet to search/modify.
 * @param sheetName - The target tab name, e.g. "Brian 07/26".
 * @returns The existing or newly-created sheet.
 */
export function findOrCreateSheet(spreadsheet: Spreadsheet, sheetName: string): Sheet {
  const existing = spreadsheet.getSheetByName(sheetName);
  if (existing) {
    return existing;
  }

  const template = spreadsheet.getSheetByName('DUPLICATE ME');
  if (!template) {
    throw new Error('Template sheet "DUPLICATE ME" not found');
  }

  const copy = template.copyTo(spreadsheet);
  copy.setName(sheetName);
  spreadsheet.setActiveSheet(copy);
  spreadsheet.moveActiveSheet(1);
  return copy;
}

/**
 * Locates the actual row number containing the literal "TOTAL OWING"
 * marker. Deliberately separate from getTotalRowAnchor() in sheetLayout.ts,
 * which returns an off-by-one-adjusted value tuned for the existing
 * settle-up math — reusing that value here for row insertion would be
 * wrong. This function is only used to find where to insert new rows;
 * recalculateSettleUp() re-derives its own anchor afterward via
 * getTotalRowAnchor(), unaffected by anything here.
 *
 * @param sheet - The sheet to search.
 * @returns The real row number of the "TOTAL OWING" marker.
 * @throws If no "TOTAL OWING" row is found.
 */
export function findTotalOwingRowIndex(sheet: Sheet): number {
  const range = sheet.getRange(2, PARTICIPANT_COLUMN_OFFSET, MAX_ROWS_TO_SEARCH, 1);
  const values = range.getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] == 'TOTAL OWING') {
      return i + 2;
    }
  }
  throw new Error('Could not find "TOTAL OWING" row in sheet "' + sheet.getName() + '"');
}
