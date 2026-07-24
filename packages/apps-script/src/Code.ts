/** Shorthand for the verbose GoogleAppsScript.Spreadsheet.Sheet type. */
type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
/** Shorthand for the verbose GoogleAppsScript.Spreadsheet.Spreadsheet type. */
type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

/** Value of the "How to split" column for an evenly-split transaction. */
const SPLIT_TYPE_EQUALLY = 'Equally';
/** Value of the "How to split" column for a percentage-split transaction. */
const SPLIT_TYPE_VARIABLY = 'Variably';

// Sheet layout — column numbers are 1-indexed, matching Sheets' own
// indexing. Columns after PARTICIPANT_COLUMN_OFFSET hold one column per
// participant (e.g. "Brian", "Patrice"), named by the header row.
const PAYEE_COLUMN = 2;
const AMOUNT_COLUMN = 3;
const SPLIT_TYPE_COLUMN = 4;
const PARTICIPANT_COLUMN_OFFSET = 4;

/** How many rows (from row 2) to scan when looking for the "TOTAL OWING" marker. */
const MAX_ROWS_TO_SEARCH = 1000;

const CHECKBOX_VALIDATION = buildCheckboxValidation();
const PERCENT_VALIDATION = buildPercentValidation();

/**
 * Simple trigger Apps Script calls on every edit made directly in the
 * sheet's UI (does not fire for edits made via the Sheets API or another
 * script — see addTransactionsForPeriod below for that path).
 *
 * @param e - The edit event Apps Script provides to onEdit simple triggers.
 */
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
  recalculateSettleUp(sheet);
}

/**
 * Placeholder for header-row edit handling — currently a no-op.
 *
 * @param sheet - The sheet the edit occurred on.
 * @param row - The edited row number (always 1 for a header edit).
 * @param col - The edited column number.
 * @param val - The cell's new value.
 */
function onHeaderChange(sheet: Sheet, row: number, col: number, val: string | undefined): void {
  //TODO(SK) something, probably.
  return;
}

/**
 * Routes a data-row edit to the split-type handler when column D changed.
 *
 * @param sheet - The sheet the edit occurred on.
 * @param row - The edited row number.
 * @param col - The edited column number.
 * @param val - The cell's new value.
 */
function onDataChange(sheet: Sheet, row: number, col: number, val: string | undefined): void {
  Logger.log('onDataChange');

  if (col == SPLIT_TYPE_COLUMN) {
    onSplitTypeChanged(sheet, row);
  }
}

/**
 * Applies the default value + data validation for every participant column
 * on `row`, based on that row's "How to split" value: a checkbox defaulted
 * to checked for "Equally", or an even percentage share for "Variably".
 * Called both from onEdit (a human picking a dropdown value) and from
 * addTransactionsForPeriod below (a row inserted via the sync API).
 *
 * @param sheet - The sheet containing the row.
 * @param row - The row whose "How to split" value changed.
 */
function onSplitTypeChanged(sheet: Sheet, row: number): void {
  Logger.log('onSplitTypeChanged');

  const participantCount = getParticipantCount(sheet);

  const isEquallySplit = isEquallySplitRow(sheet, row);
  const isVariablySplit = isVariablySplitRow(sheet, row);

  for (let i = 0; i < participantCount; i++) {
    const col = PARTICIPANT_COLUMN_OFFSET + i + 1;
    const range = sheet.getRange(row, col);

    // Update this row col to be a variable percentage split
    if (isVariablySplit) {
      range.setValue(100 / participantCount + '%');
      range.setDataValidation(PERCENT_VALIDATION);
      // Update this row col to be an equal, checkbox togglerable split
    } else if (isEquallySplit) {
      range.setValue(true);
      range.setDataValidation(CHECKBOX_VALIDATION);
    }
  }
}

/**
 * Number of participant columns, derived from how far the header row extends.
 *
 * @param sheet - The sheet to inspect.
 * @returns The number of participant columns (e.g. 2 for Brian + Patrice).
 */
function getParticipantCount(sheet: Sheet): number {
  const lastColumn = sheet.getLastColumn();
  return lastColumn - PARTICIPANT_COLUMN_OFFSET;
}

/**
 * Participant names, read from the header row's participant columns.
 *
 * @param sheet - The sheet to inspect.
 * @returns Participant names in column order, e.g. ["Brian", "Patrice"].
 */
function getParticipantNames(sheet: Sheet): string[] {
  const participantCount = getParticipantCount(sheet);
  const headerRange = sheet.getRange(1, PARTICIPANT_COLUMN_OFFSET + 1, 1, participantCount);
  return headerRange.getValues()[0];
}

/**
 * Builds the data validation rule that renders a cell as a checkbox.
 *
 * @returns A checkbox data validation rule.
 */
function buildCheckboxValidation(): GoogleAppsScript.Spreadsheet.DataValidation {
  return SpreadsheetApp.newDataValidation().requireCheckbox().build();
}

/**
 * Builds the data validation rule that requires a cell's text to look like
 * a percentage, e.g. "50%".
 *
 * @returns A formula-based data validation rule for percentage strings.
 */
function buildPercentValidation(): GoogleAppsScript.Spreadsheet.DataValidation {
  const formula =
    '=REGEXMATCH(TO_TEXT(INDIRECT(CONCATENATE("R", TO_TEXT(ROW()), "C", TO_TEXT(COLUMN())), FALSE)), "^\\d+(?:\\.\\d+)?%$")';
  return SpreadsheetApp.newDataValidation().requireFormulaSatisfied(formula).build();
}

/**
 * Scans down column D from row 2 for the literal "TOTAL OWING" marker and
 * returns its row number — 1, used as a computation anchor by the
 * settle-up math further down this file (buildDebtMatrix,
 * computeSettlementPayments, writeSettlementPayments all take this same
 * off-by-one value, not the marker's real row number).
 *
 * Deliberately separate from findTotalOwingRowIndex near the bottom of
 * this file, which returns the real row number and is used only to decide
 * where to insert new rows — reusing that value here would be wrong.
 *
 * @param sheet - The sheet to search.
 * @returns The off-by-one row anchor, or `undefined` if no "TOTAL OWING"
 *   row was found — unreachable in normal use, since a real one always
 *   exists; see the `alert` note inside.
 */
function getTotalRowAnchor(sheet: Sheet): number | undefined {
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
  alert('Could not find total row');
  return undefined;
}

/**
 * Returns a square matrix filled with zeros.
 *
 * @param size - Width and height of the matrix.
 * @returns A `size` x `size` matrix, every cell 0.
 */
function createZeroMatrix(size: number): number[][] {
  const matrix: number[][] = [];
  for (let i = 0; i < size; i++) {
    matrix.push([]);
    for (let j = 0; j < size; j++) {
      matrix[i].push(0);
    }
  }
  return matrix;
}

/**
 * Maps each participant name to its position in the participant column list.
 *
 * @param participantNames - Participant names in column order.
 * @returns A lookup from participant name to column index, e.g. `{ Brian: 0, Patrice: 1 }`.
 */
function getParticipantIndexByName(participantNames: string[]): Record<string, number> {
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
function isEquallySplitRow(sheet: Sheet, row: number): boolean {
  const range = sheet.getRange(row, SPLIT_TYPE_COLUMN);
  const val = range.getValue();
  return val == SPLIT_TYPE_EQUALLY;
}

/**
 * @param sheet - The sheet containing the row.
 * @param row - The row to check.
 * @param participantCount - How many participant columns to scan.
 * @returns How many participant checkboxes are checked (true) on an equally-split row.
 */
function countEquallySplitParticipants(sheet: Sheet, row: number, participantCount: number): number {
  let count = 0;
  for (let i = 0; i < participantCount; i++) {
    const col = PARTICIPANT_COLUMN_OFFSET + i + 1;
    const range = sheet.getRange(row, col);
    const val = range.getValue();
    if (val == true) {
      count++;
    }
  }
  return count;
}

/**
 * @param sheet - The sheet containing the row.
 * @param row - The row to check.
 * @returns Whether `row`'s "How to split" value is "Variably".
 */
function isVariablySplitRow(sheet: Sheet, row: number): boolean {
  const range = sheet.getRange(row, SPLIT_TYPE_COLUMN);
  const val = range.getValue();
  return val == SPLIT_TYPE_VARIABLY;
}

/**
 * @param sheet - The sheet containing the row.
 * @param row - The row to sum.
 * @param participantCount - How many participant columns to scan.
 * @returns Sum of the participant-column share values on a variably-split row (should total ~100).
 */
function sumVariableSplitShares(sheet: Sheet, row: number, participantCount: number): number {
  let total = 0;
  for (let i = 0; i < participantCount; i++) {
    const col = PARTICIPANT_COLUMN_OFFSET + i + 1;
    const range = sheet.getRange(row, col);
    const val = range.getValue();
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
function getPayeeNamesForRows(sheet: Sheet, totalRowAnchor: number): string[] {
  const payeeRange = sheet.getRange(2, PAYEE_COLUMN, totalRowAnchor - 1, 1);
  const payeeValues = payeeRange.getValues();
  const payeeNames: string[] = [];
  for (let i = 0; i < payeeValues.length; i++) {
    payeeNames.push(payeeValues[i][0]);
  }
  return payeeNames;
}

/**
 * Builds a participantCount x participantCount debt matrix from every
 * transaction row, where debtMatrix[payerIndex][payeeIndex] is the total
 * amount payerIndex owes payeeIndex across all transactions. For each row:
 * an equally-split amount is divided evenly among the checked participants;
 * a variably-split amount is divided proportionally to each participant's
 * share value.
 *
 * @param sheet - The sheet to read transaction rows from.
 * @param participantNames - Participant names in column order.
 * @param participantIndexByName - Lookup from participant name to index.
 * @param participantCount - Number of participants.
 * @param totalRowAnchor - The off-by-one anchor from getTotalRowAnchor.
 * @returns The debt matrix; `debtMatrix[payerIndex][payeeIndex]` is what
 *   `payerIndex` owes `payeeIndex`.
 */
function buildDebtMatrix(
  sheet: Sheet,
  participantNames: string[],
  participantIndexByName: Record<string, number>,
  participantCount: number,
  totalRowAnchor: number,
): number[][] {
  Logger.log('Build Graph');

  const debtMatrix = createZeroMatrix(participantCount);
  const payeeNames = getPayeeNamesForRows(sheet, totalRowAnchor);
  for (let payeeNameIndex = 0; payeeNameIndex < payeeNames.length; payeeNameIndex++) {
    const payeeName = payeeNames[payeeNameIndex];
    const transactionRow = payeeNameIndex + 2;

    const payeeIndex = participantIndexByName[payeeName];
    const amountRange = sheet.getRange(transactionRow, AMOUNT_COLUMN, 1, 1);
    const amount = amountRange.getValue();

    const isEquallySplit = isEquallySplitRow(sheet, transactionRow);
    let equallySplitParticipantCount = 0;
    if (isEquallySplit) {
      equallySplitParticipantCount = countEquallySplitParticipants(sheet, transactionRow, participantCount);
    }

    const isVariablySplit = isVariablySplitRow(sheet, transactionRow);
    let totalVariableShares = 0;
    if (isVariablySplit) {
      totalVariableShares = sumVariableSplitShares(sheet, transactionRow, participantCount);
    }

    for (let payerIndex = 0; payerIndex < participantCount; payerIndex++) {
      if (payerIndex == payeeIndex) {
        continue;
      }
      const payerColumn = PARTICIPANT_COLUMN_OFFSET + payerIndex + 1;
      const participantSplitRange = sheet.getRange(transactionRow, payerColumn);
      const participantSplitValue = participantSplitRange.getValue();
      if (isEquallySplit && participantSplitValue == true) {
        const owedAmount = amount / equallySplitParticipantCount;
        debtMatrix[payerIndex][payeeIndex] += owedAmount;
      } else if (isVariablySplit && participantSplitValue != 0) {
        const owedAmount = (participantSplitValue / totalVariableShares) * amount;
        debtMatrix[payerIndex][payeeIndex] += owedAmount;
      }
    }
  }

  return debtMatrix;
}

/**
 * @param values - Values to search.
 * @returns The index of the smallest value in `values`.
 */
function indexOfMin(values: number[]): number {
  let min = values[0];
  let minIndex = 0;

  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) {
      minIndex = i;
      min = values[i];
    }
  }
  return minIndex;
}

/**
 * @param values - Values to search.
 * @returns The index of the largest value in `values`.
 */
function indexOfMax(values: number[]): number {
  let max = values[0];
  let maxIndex = 0;

  for (let i = 1; i < values.length; i++) {
    if (values[i] > max) {
      maxIndex = i;
      max = values[i];
    }
  }
  return maxIndex;
}

/**
 * Reduces the debt matrix to the minimal set of payments that settles
 * every balance, via a greedy algorithm: repeatedly match whoever is owed
 * the most against whoever owes the most, record a payment between them
 * for the smaller of the two amounts, and repeat until every net balance
 * is (within floating-point tolerance) zero.
 *
 * @param sheet - Unused directly, but kept for signature parity with computeSettlementPayments.
 * @param debtMatrix - Pairwise debts, as built by buildDebtMatrix.
 * @param participantNames - Participant names in column order.
 * @param participantIndexByName - Lookup from participant name to index.
 * @param participantCount - Number of participants.
 * @param totalRowAnchor - The off-by-one anchor from getTotalRowAnchor.
 * @returns Payments as `[payerIndex, payeeIndex, paymentAmount]` tuples.
 */
function simplifyDebts(
  sheet: Sheet,
  debtMatrix: number[][],
  participantNames: string[],
  participantIndexByName: Record<string, number>,
  participantCount: number,
  totalRowAnchor: number,
): number[][] {
  const netBalances: number[] = [];

  for (let participantIndex = 0; participantIndex < participantCount; participantIndex++) {
    let netBalance = 0;
    for (let otherParticipantIndex = 0; otherParticipantIndex < participantCount; otherParticipantIndex++) {
      netBalance +=
        debtMatrix[otherParticipantIndex][participantIndex] - debtMatrix[participantIndex][otherParticipantIndex];
    }
    netBalances.push(netBalance);
  }

  const settlementPayments: number[][] = [];
  while (true) {
    const payeeIndex = indexOfMax(netBalances);
    const payerIndex = indexOfMin(netBalances);
    // fml floating point math
    if (Math.abs(netBalances[payeeIndex]) < 0.005 && Math.abs(netBalances[payerIndex]) < 0.005) {
      return settlementPayments;
    }
    const paymentAmount = Math.min(-netBalances[payerIndex], netBalances[payeeIndex]);
    netBalances[payeeIndex] -= paymentAmount;
    netBalances[payerIndex] += paymentAmount;
    settlementPayments.push([payerIndex, payeeIndex, paymentAmount]);
  }
}

/**
 * Decides how to present the debt matrix as a list of payments: if the
 * "simplify" checkbox (one row below the header, in the split-type column)
 * is checked, reduces it to a minimal set via simplifyDebts; otherwise
 * returns every non-zero pairwise debt verbatim.
 *
 * @param sheet - The sheet to read the "simplify" toggle from.
 * @param debtMatrix - Pairwise debts, as built by buildDebtMatrix.
 * @param participantNames - Participant names in column order.
 * @param participantIndexByName - Lookup from participant name to index.
 * @param participantCount - Number of participants.
 * @param totalRowAnchor - The off-by-one anchor from getTotalRowAnchor.
 * @returns Payments as `[payerIndex, payeeIndex, paymentAmount]` tuples.
 */
function computeSettlementPayments(
  sheet: Sheet,
  debtMatrix: number[][],
  participantNames: string[],
  participantIndexByName: Record<string, number>,
  participantCount: number,
  totalRowAnchor: number,
): number[][] {
  const simplifyToggleRow = totalRowAnchor + 1 + 1; // header + 1
  const simplifyToggleColumn = SPLIT_TYPE_COLUMN;
  const simplifyToggleRange = sheet.getRange(simplifyToggleRow, simplifyToggleColumn);
  const shouldSimplifyDebts = simplifyToggleRange.getValue();

  Logger.log(shouldSimplifyDebts);
  if (shouldSimplifyDebts == true) {
    return simplifyDebts(sheet, debtMatrix, participantNames, participantIndexByName, participantCount, totalRowAnchor);
  }

  const payments: number[][] = [];
  // Spit out the payments verbatim
  for (let payerIndex = 0; payerIndex < debtMatrix.length; payerIndex++) {
    const owedToOthers = debtMatrix[payerIndex];
    for (let payeeIndex = 0; payeeIndex < owedToOthers.length; payeeIndex++) {
      const amount = owedToOthers[payeeIndex];
      if (amount > 0.005) {
        payments.push([payerIndex, payeeIndex, amount]);
      }
    }
  }
  return payments;
}

/**
 * Clears the settle-up summary area and writes each computed payment as
 * "<payee name> $<amount>" beneath the "TOTAL OWING" marker, one column
 * per payer, stacking multiple payments from the same payer downward.
 *
 * @param sheet - The sheet to write into.
 * @param payments - Payments as `[payerIndex, payeeIndex, paymentAmount]` tuples.
 * @param participantNames - Participant names in column order.
 * @param participantIndexByName - Lookup from participant name to index.
 * @param participantCount - Number of participants.
 * @param totalRowAnchor - The off-by-one anchor from getTotalRowAnchor.
 */
function writeSettlementPayments(
  sheet: Sheet,
  payments: number[][],
  participantNames: string[],
  participantIndexByName: Record<string, number>,
  participantCount: number,
  totalRowAnchor: number,
): void {
  const nextRowOffsetByPayerIndex: number[] = [];
  for (let i = 0; i < participantCount; i++) {
    nextRowOffsetByPayerIndex.push(0);
  }

  const settlementAreaRange = sheet.getRange(
    totalRowAnchor + 1,
    PARTICIPANT_COLUMN_OFFSET + 1,
    participantCount,
    participantCount,
  );
  settlementAreaRange.clear({
    contentsOnly: true,
  });

  for (let i = 0; i < payments.length; i++) {
    const payment = payments[i];
    const payerIndex = payment[0];
    const payeeIndex = payment[1];
    const payeeName = participantNames[payeeIndex];
    const amount = payment[2];
    const outputCell = sheet.getRange(
      totalRowAnchor + nextRowOffsetByPayerIndex[payerIndex] + 1,
      PARTICIPANT_COLUMN_OFFSET + payerIndex + 1,
    );
    const formattedAmount = '$' + amount.toFixed(2);
    outputCell.setValue(payeeName + ' ' + formattedAmount);
    nextRowOffsetByPayerIndex[payerIndex] = nextRowOffsetByPayerIndex[payerIndex] + 1;
  }
}

/**
 * Recomputes the "who owes whom" settle-up summary: builds the debt matrix
 * from every transaction row, reduces it to a payment list (simplified or
 * verbatim per the sheet's toggle), and writes that list below the
 * "TOTAL OWING" marker. Called after every edit (via onEdit) and after
 * every batch of rows added via the sync API (via addTransactionsForPeriod).
 *
 * @param sheet - The sheet to recalculate.
 */
function recalculateSettleUp(sheet: Sheet): void {
  Logger.log('Calculate');

  const participantNames = getParticipantNames(sheet);
  const participantIndexByName = getParticipantIndexByName(participantNames);
  const participantCount = getParticipantCount(sheet);
  // getTotalRowAnchor's `undefined` path is unreachable in normal use (a
  // real "TOTAL OWING" row always exists) — asserted here rather than
  // guarded with an early return, to keep this exactly as behaviorally
  // faithful to the original untyped version as possible. See the note on
  // getTotalRowAnchor.
  const totalRowAnchor = getTotalRowAnchor(sheet) as number;
  Logger.log('variables Set in Calculate');

  const debtMatrix = buildDebtMatrix(sheet, participantNames, participantIndexByName, participantCount, totalRowAnchor);
  Logger.log('calculate payments in Calculate');

  const payments = computeSettlementPayments(
    sheet,
    debtMatrix,
    participantNames,
    participantIndexByName,
    participantCount,
    totalRowAnchor,
  );
  Logger.log('RenderPayments');

  writeSettlementPayments(sheet, payments, participantNames, participantIndexByName, participantCount, totalRowAnchor);
  Logger.log('renderPayments and calculate completed');
}

// ---------------------------------------------------------------------
// Everything below this line is new: an HTTP entry point so the sync
// tooling in packages/automation can push rows into this sheet the same
// way a manual paste + dropdown selection would, without needing to
// reimplement the checkbox/percent defaulting or the settle-up math above
// in TypeScript. Nothing above this line has been modified beyond adding
// type annotations, renaming identifiers, and JSDoc for local development.
// ---------------------------------------------------------------------

/** Script Properties key holding the shared secret doPost checks incoming requests against. */
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
 * columns A-D; columns E onward are recomputed by onSplitTypeChanged above,
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

/**
 * Wraps a value as a JSON HTTP response body for a Web App request.
 *
 * @param body - The value to serialize as the response body.
 * @returns A `TextOutput` with `application/json` content type.
 */
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
 * the existing recalculateSettleUp().
 *
 * @param payerName - Who paid, e.g. "Brian" — determines the target tab's name.
 * @param periodLabel - The billing period, e.g. "07/26" — the rest of the target tab's name.
 * @param rows - Each row is [description, payerName, amount, splitType] (columns A-D).
 * @returns The target sheet's name and how many rows were added.
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
 * marker. Deliberately separate from getTotalRowAnchor() above, which
 * returns an off-by-one-adjusted value tuned for the existing settle-up
 * math further up this file — reusing that value here for row insertion
 * would be wrong. This function is only used to find where to insert new
 * rows; recalculateSettleUp() re-derives its own anchor afterward via
 * getTotalRowAnchor(), unaffected by anything here.
 *
 * @param sheet - The sheet to search.
 * @returns The real row number of the "TOTAL OWING" marker.
 * @throws If no "TOTAL OWING" row is found.
 */
function findTotalOwingRowIndex(sheet: Sheet): number {
  const range = sheet.getRange(2, PARTICIPANT_COLUMN_OFFSET, MAX_ROWS_TO_SEARCH, 1);
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
