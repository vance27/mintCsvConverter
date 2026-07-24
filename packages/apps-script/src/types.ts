/** Shorthand for the verbose GoogleAppsScript.Spreadsheet.Sheet type. */
export type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
/** Shorthand for the verbose GoogleAppsScript.Spreadsheet.Spreadsheet type. */
export type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

export interface AddTransactionsResult {
  sheetName: string;
  rowsAdded: number;
}

export interface AddTransactionsPayload {
  token?: string;
  payerName?: string;
  periodLabel?: string;
  rows?: string[][];
}
