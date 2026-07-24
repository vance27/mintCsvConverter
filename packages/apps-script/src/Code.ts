/*
 * Hello there, inquisitive  friend.
 *
 * Hacked by Sam Killin, August 2018.
 * www.homies.rent
 * help@homies.rent
 */

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

const VARIABLY_LABEL = 'Variably';
const EQUALLY_LABEL = 'Equally';
const TENANT_COLUMN_OFFSET = 4;
const PAYEE_COLUMN = 2;
const AMOUNT_COLUMN = 3;
const SPLIT_TYPE_COLUMN = 4;
const ROWS_TO_SEARCH_TOTAL = 1000;
const CHECKBOX_VALIDATOR = buildCheckboxValidator();
const PERCENT_VALIDATOR = buildPercentValidator();

function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  Logger.log('Starting Edit');
  const row = e.range.getRow();
  const sheet = e.source.getActiveSheet();
  const val = e.value;
  const col = e.range.getColumn();

  if (row == 1) {
    onHeaderChange(sheet, row, col, val);
  } else {
    onDataChange(sheet, row, col, val);
  }
  calculate(sheet);
}

function onHeaderChange(sheet: Sheet, row: number, col: number, val: string | undefined): void {
  //TODO(SK) something, probably.
  return;
}

function onDataChange(sheet: Sheet, row: number, col: number, val: string | undefined): void {
  Logger.log('onDataChange');

  if (col == SPLIT_TYPE_COLUMN) {
    onSplitTypeChanged(sheet, row);
  }
}

function onSplitTypeChanged(sheet: Sheet, row: number): void {
  Logger.log('onSplitTypeChanged');

  const numTenants = getNumberOfTenants(sheet);

  const isEqual = isEqualPaymentRow(sheet, row);
  const isVariable = isVariablePaymentRow(sheet, row);

  for (let i = 0; i < numTenants; i++) {
    const col = TENANT_COLUMN_OFFSET + i + 1;
    const range = sheet.getRange(row, col);

    // Update this row col to be a variable percentage split
    if (isVariable) {
      range.setValue(100 / numTenants + '%');
      range.setDataValidation(PERCENT_VALIDATOR);
      // Update this row col to be an equal, checkbox togglerable split
    } else if (isEqual) {
      range.setValue(true);
      range.setDataValidation(CHECKBOX_VALIDATOR);
    }
  }
}

function getNumberOfTenants(sheet: Sheet): number {
  const lastColumn = sheet.getLastColumn();
  return lastColumn - TENANT_COLUMN_OFFSET;
}

function getTenantNames(sheet: Sheet): string[] {
  const numTenants = getNumberOfTenants(sheet);
  const headerRange = sheet.getRange(1, TENANT_COLUMN_OFFSET + 1, 1, numTenants);
  return headerRange.getValues()[0];
}

function buildCheckboxValidator(): GoogleAppsScript.Spreadsheet.DataValidation {
  return SpreadsheetApp.newDataValidation().requireCheckbox().build();
}

function buildPercentValidator(): GoogleAppsScript.Spreadsheet.DataValidation {
  const formula =
    '=REGEXMATCH(TO_TEXT(INDIRECT(CONCATENATE("R", TO_TEXT(ROW()), "C", TO_TEXT(COLUMN())), FALSE)), "^\\d+(?:\\.\\d+)?%$")';
  return SpreadsheetApp.newDataValidation().requireFormulaSatisfied(formula).build();
}

function getTotalRow(sheet: Sheet): number | undefined {
  const range = sheet.getRange(2, TENANT_COLUMN_OFFSET, ROWS_TO_SEARCH_TOTAL, 1);
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
  alert('Could not find total row');
  return undefined;
}

function zeros(size: number): number[][] {
  const array: number[][] = [];
  for (let i = 0; i < size; i++) {
    array.push([]);
    for (let j = 0; j < size; j++) {
      array[i].push(0);
    }
  }
  return array;
}

function getTenantIndexes(tenantNames: string[]): Record<string, number> {
  const tenantIndexes: Record<string, number> = {};
  for (let i = 0; i < tenantNames.length; i++) {
    tenantIndexes[tenantNames[i]] = i;
  }
  return tenantIndexes;
}

function isEqualPaymentRow(sheet: Sheet, row: number): boolean {
  const range = sheet.getRange(row, SPLIT_TYPE_COLUMN);
  const val = range.getValue();
  return val == EQUALLY_LABEL;
}

function numEqualSplitting(sheet: Sheet, row: number, numTenants: number): number {
  let count = 0;
  for (let i = 0; i < numTenants; i++) {
    const col = TENANT_COLUMN_OFFSET + i + 1;
    const range = sheet.getRange(row, col);
    const val = range.getValue();
    if (val == true) {
      count++;
    }
  }
  return count;
}

function isVariablePaymentRow(sheet: Sheet, row: number): boolean {
  const range = sheet.getRange(row, SPLIT_TYPE_COLUMN);
  const val = range.getValue();
  return val == VARIABLY_LABEL;
}

function calculateTotalVariable(sheet: Sheet, row: number, numTenants: number): number {
  let total = 0;
  for (let i = 0; i < numTenants; i++) {
    const col = TENANT_COLUMN_OFFSET + i + 1;
    const range = sheet.getRange(row, col);
    const val = range.getValue();
    total += val;
  }
  return total;
}

function getOweeNames(sheet: Sheet, totalRow: number): string[] {
  const oweeRange = sheet.getRange(2, PAYEE_COLUMN, totalRow - 1, 1);
  const oweeValues = oweeRange.getValues();
  const owees: string[] = [];
  for (let i = 0; i < oweeValues.length; i++) {
    owees.push(oweeValues[i][0]);
  }
  return owees;
}

function buildGraph(
  sheet: Sheet,
  tenantNames: string[],
  tenantIndexes: Record<string, number>,
  numTenants: number,
  totalRow: number,
): number[][] {
  Logger.log('Build Graph');

  const graph = zeros(numTenants);
  const oweeNames = getOweeNames(sheet, totalRow);
  for (let oweeNameIdx = 0; oweeNameIdx < oweeNames.length; oweeNameIdx++) {
    const oweeName = oweeNames[oweeNameIdx];
    const oweeRow = oweeNameIdx + 2;

    const oweeIdx = tenantIndexes[oweeName];
    const amountRange = sheet.getRange(oweeRow, AMOUNT_COLUMN, 1, 1);
    const amount = amountRange.getValue();

    const isEqual = isEqualPaymentRow(sheet, oweeRow);
    let numEqual = 0;
    if (isEqual) {
      numEqual = numEqualSplitting(sheet, oweeRow, numTenants);
    }

    const isVariable = isVariablePaymentRow(sheet, oweeRow);
    let totalVariable = 0;
    if (isVariable) {
      totalVariable = calculateTotalVariable(sheet, oweeRow, numTenants);
    }

    for (let payerIdx = 0; payerIdx < numTenants; payerIdx++) {
      if (payerIdx == oweeIdx) {
        continue;
      }
      const payerCol = TENANT_COLUMN_OFFSET + payerIdx + 1;
      const paymentSplitRange = sheet.getRange(oweeRow, payerCol);
      const paymentSplit = paymentSplitRange.getValue();
      if (isEqual && paymentSplit == true) {
        const splitAmount = amount / numEqual;
        graph[payerIdx][oweeIdx] += splitAmount;
      } else if (isVariable && paymentSplit != 0) {
        const absoluteAmount = (paymentSplit / totalVariable) * amount;
        graph[payerIdx][oweeIdx] += absoluteAmount;
      }
    }
  }

  return graph;
}

function arrayMin(arr: number[]): number {
  let min = arr[0];
  let minIndex = 0;

  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < min) {
      minIndex = i;
      min = arr[i];
    }
  }
  return minIndex;
}

function arrayMax(arr: number[]): number {
  let max = arr[0];
  let maxIndex = 0;

  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > max) {
      maxIndex = i;
      max = arr[i];
    }
  }
  return maxIndex;
}

function calculateSimplifiedPayments(
  sheet: Sheet,
  graph: number[][],
  tenantNames: string[],
  tenantIndexes: Record<string, number>,
  numTenants: number,
  totalRow: number,
): number[][] {
  const amounts: number[] = [];

  for (let owedIdx = 0; owedIdx < numTenants; owedIdx++) {
    let owing = 0;
    for (let oweingIdx = 0; oweingIdx < numTenants; oweingIdx++) {
      owing += graph[oweingIdx][owedIdx] - graph[owedIdx][oweingIdx];
    }
    amounts.push(owing);
  }

  const payments: number[][] = [];
  while (true) {
    const payee_idx = arrayMax(amounts);
    const payer_idx = arrayMin(amounts);
    // fml floating point math
    if (Math.abs(amounts[payee_idx]) < 0.005 && Math.abs(amounts[payer_idx]) < 0.005) {
      return payments;
    }
    const payment_amount = Math.min(-amounts[payer_idx], amounts[payee_idx]);
    amounts[payee_idx] -= payment_amount;
    amounts[payer_idx] += payment_amount;
    payments.push([payer_idx, payee_idx, payment_amount]);
  }
}

function calculatePayments(
  sheet: Sheet,
  graph: number[][],
  tenantNames: string[],
  tenantIndexes: Record<string, number>,
  numTenants: number,
  totalRow: number,
): number[][] {
  const simplifyRow = totalRow + 1 + 1; // header + 1
  const simplifyCol = SPLIT_TYPE_COLUMN;
  const simplifyRange = sheet.getRange(simplifyRow, simplifyCol);
  const simplifyVal = simplifyRange.getValue();

  Logger.log(simplifyVal);
  // Calculate simplified payments
  if (simplifyVal == true) {
    return calculateSimplifiedPayments(sheet, graph, tenantNames, tenantIndexes, numTenants, totalRow);
  }

  const payments: number[][] = [];
  // Spit out the payments verbatim
  for (let i = 0; i < graph.length; i++) {
    const owing = graph[i];
    for (let j = 0; j < owing.length; j++) {
      const amount = owing[j];
      if (amount > 0.005) {
        payments.push([i, j, amount]);
      }
    }
  }
  return payments;
}

function renderPayments(
  sheet: Sheet,
  payments: number[][],
  tenantNames: string[],
  tenantIndexes: Record<string, number>,
  numTenants: number,
  totalRow: number,
): void {
  const indexes: number[] = [];
  for (let i = 0; i < numTenants; i++) {
    indexes.push(0);
  }

  const clearRange = sheet.getRange(totalRow + 1, TENANT_COLUMN_OFFSET + 1, numTenants, numTenants);
  clearRange.clear({
    contentsOnly: true,
  });

  for (let i = 0; i < payments.length; i++) {
    const payment = payments[i];
    const payerIdx = payment[0];
    const payeeIdx = payment[1];
    const payeeName = tenantNames[payeeIdx];
    const amount = payment[2];
    const range = sheet.getRange(totalRow + indexes[payerIdx] + 1, TENANT_COLUMN_OFFSET + payerIdx + 1);
    const amountStr = '$' + amount.toFixed(2);
    range.setValue(payeeName + ' ' + amountStr);
    indexes[payerIdx] = indexes[payerIdx] + 1;
  }
}

function calculate(sheet: Sheet): void {
  Logger.log('Calculate');

  const tenantNames = getTenantNames(sheet);
  const tenantIndexes = getTenantIndexes(tenantNames);
  const numTenants = getNumberOfTenants(sheet);
  // getTotalRow's `undefined` path is unreachable in normal use (a real
  // "TOTAL OWING" row always exists) — asserted here rather than guarded
  // with an early return, to keep this exactly as behaviorally faithful to
  // the original untyped version as possible. See the note on getTotalRow.
  const totalRow = getTotalRow(sheet) as number;
  Logger.log('variables Set in Calculate');

  const graph = buildGraph(sheet, tenantNames, tenantIndexes, numTenants, totalRow);
  Logger.log('calculate payments in Calculate');

  const payments = calculatePayments(sheet, graph, tenantNames, tenantIndexes, numTenants, totalRow);
  Logger.log('RenderPayments');

  renderPayments(sheet, payments, tenantNames, tenantIndexes, numTenants, totalRow);
  Logger.log('renderPayments and calculate completed');
}

// ---------------------------------------------------------------------
// Everything below this line is new: an HTTP entry point so the sync
// tooling in packages/automation can push rows into this sheet the same
// way a manual paste + dropdown selection would, without needing to
// reimplement the checkbox/percent defaulting or the settle-up math above
// in TypeScript. Nothing above this line has been modified beyond adding
// type annotations for local development.
// ---------------------------------------------------------------------

const SYNC_TOKEN_PROPERTY_KEY = 'SYNC_TOKEN';

interface AddTransactionsResult {
  sheetName: string;
  rowsAdded: number;
}

interface AddTransactionsPayload {
  token?: string;
  payerName?: string;
  periodLabel?: string;
  rows?: string[][];
}

/**
 * Web App entry point (deploy as "Execute as: Me", "Who has access: Anyone
 * with the link"). Expects a JSON POST body:
 *   { token: string, payerName: string, periodLabel: string, rows: string[][] }
 * where each row is [description, payerName, amount, splitType] (matching
 * columns A-D; columns E onward are recomputed by onSplitTypeChanged below,
 * not supplied by the caller).
 *
 * Apps Script Web Apps always return HTTP 200 regardless of what happens
 * inside doPost — there is no API to set a different status code — so
 * callers must check the `ok` field in the JSON response body, not the
 * HTTP status.
 */
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    const payload: AddTransactionsPayload = JSON.parse(e.postData.contents);

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

function jsonResponse(body: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Finds (or creates, by duplicating the "DUPLICATE ME" template — which
 * preserves all formatting/validation/conditional formatting exactly like
 * clicking "Duplicate" would) the "<payerName> <periodLabel>" sheet, appends
 * `rows` just above the "TOTAL OWING" marker, applies the same
 * checkbox/percent defaulting a manual dropdown selection would via the
 * existing onSplitTypeChanged, then recalculates the settle-up summary via
 * the existing calculate().
 */
function addTransactionsForPeriod(payerName: string, periodLabel: string, rows: string[][]): AddTransactionsResult {
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

  calculate(sheet);

  return { sheetName, rowsAdded: rows.length };
}

function findOrCreateSheet(spreadsheet: Spreadsheet, sheetName: string): Sheet {
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
 * marker. Deliberately separate from getTotalRow() above, which returns an
 * off-by-one-adjusted value tuned for the existing settle-up math further
 * up this file — reusing that value here for row insertion would be
 * wrong. This function is only used to find where to insert new rows;
 * calculate() re-derives its own totalRow afterward via getTotalRow(),
 * unaffected by anything here.
 */
function findTotalOwingRowIndex(sheet: Sheet): number {
  const range = sheet.getRange(2, TENANT_COLUMN_OFFSET, ROWS_TO_SEARCH_TOTAL, 1);
  const values = range.getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] == 'TOTAL OWING') {
      return i + 2;
    }
  }
  throw new Error('Could not find "TOTAL OWING" row in sheet "' + sheet.getName() + '"');
}

// Apps Script loads this file as a global script, not a module — this
// export exists only so Rollup treats the file as an ES module during the
// build; rollup.config.mjs strips it from the final bundle.
export {};
