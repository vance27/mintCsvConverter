import { sheets_v4 } from '@googleapis/sheets';
import { script_v1 } from '@googleapis/script';
import { loadSavedCredentialsOrThrow } from './googleAuth.js';

export interface AddTransactionsRequest {
  payerName: string;
  periodLabel: string;
  /** Each row is [description, payerName, amount, splitType] — columns A-D only. */
  rows: string[][];
  /**
   * Per-row manifest-matched percentages, aligned 1:1 with `rows` — a
   * participant-name-keyed split (e.g. `{ Brian: 62, Patrice: 38 }`) for a
   * 'Variably' row with a receipt-manifest match, or null otherwise.
   * Applied by the Apps Script side (which knows the sheet's actual
   * participant column layout) instead of written positionally here, so
   * this stays a name-keyed map rather than raw column values.
   */
  rowPercentages?: (Record<string, number> | null)[];
}

export interface AddTransactionsResult {
  sheetName: string;
  rowsAdded: number;
}

// Narrowed to just the one call shape SheetsClient actually uses for each
// method (matching this package's existing Pick<SheetsClient,
// 'addTransactionsForPeriod'> style in sync.ts) — NOT Pick'd directly from
// the real API classes, since their methods are heavily overloaded (a
// streaming variant alongside the plain-Promise one this class uses), and
// TypeScript requires an assigned function to satisfy every overload, which
// a simple test fake can't. A real sheets_v4.Sheets/script_v1.Script
// instance already satisfies these narrower single-signature interfaces
// (an overloaded method is assignable to a narrower expected shape), and
// tests can pass a plain fake instead of standing up the full API client.
export interface SpreadsheetsClient {
  get(params: {
    spreadsheetId: string;
    includeGridData?: boolean;
  }): Promise<{ data: { sheets?: sheets_v4.Schema$Sheet[] | null } }>;
  batchUpdate(params: {
    spreadsheetId: string;
    requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest;
  }): Promise<{ data: sheets_v4.Schema$BatchUpdateSpreadsheetResponse }>;
  values: {
    get(params: { spreadsheetId: string; range: string }): Promise<{ data: sheets_v4.Schema$ValueRange }>;
    update(params: {
      spreadsheetId: string;
      range: string;
      valueInputOption: string;
      requestBody: sheets_v4.Schema$ValueRange;
    }): Promise<{ data: sheets_v4.Schema$UpdateValuesResponse }>;
  };
}
export interface ScriptClient {
  scripts: {
    run(params: {
      scriptId: string;
      requestBody: script_v1.Schema$ExecutionRequest;
    }): Promise<{ data: script_v1.Schema$Operation }>;
  };
}

export interface SheetsClientConfig {
  spreadsheetId: string;
  /** The Apps Script project's script ID (same as .clasp.json's scriptId). */
  scriptId: string;
  sheets: { spreadsheets: SpreadsheetsClient };
  script: ScriptClient;
}

// Mirrors packages/apps-script/src/sheetLayout.ts's layout constants — kept
// in sync by hand since these describe the sheet's fixed column layout, not
// something either side computes from the other.
const TOTAL_OWING_COLUMN = 4; // column D, 1-indexed
const MAX_ROWS_TO_SEARCH = 1000;
const TEMPLATE_SHEET_NAME = 'DUPLICATE ME';
const FINALIZE_FUNCTION_NAME = 'finalizeAddedRows';

/**
 * Writes transaction rows into the sheet (via the Sheets API — generic
 * spreadsheet mechanics, no reason to route through Apps Script) and then
 * finalizes them (via the Apps Script API's scripts.run, calling
 * finalizeAddedRows — the checkbox/percent defaulting and settle-up
 * recalculation only exist there, not reimplemented here).
 */
export class SheetsClient {
  constructor(private readonly config: SheetsClientConfig) {}

  async addTransactionsForPeriod(request: AddTransactionsRequest): Promise<AddTransactionsResult> {
    const sheetName = `${request.payerName} ${request.periodLabel}`;
    const { sheetId, created } = await this.findOrCreateSheet(sheetName);

    if (request.rows.length === 0) {
      return { sheetName, rowsAdded: 0 };
    }

    const insertRow = await this.findTotalOwingRow(sheetName);
    await this.insertRows(sheetId, insertRow, request.rows.length);
    await this.writeRowValues(sheetName, insertRow, request.rows);

    try {
      await this.finalizeAddedRows(sheetName, insertRow, request.rows.length, request.rowPercentages);
    } catch (finalizeError) {
      await this.rollback(sheetId, created, insertRow, request.rows.length, finalizeError);
    }

    return { sheetName, rowsAdded: request.rows.length };
  }

  private async findOrCreateSheet(sheetName: string): Promise<{ sheetId: number; created: boolean }> {
    const spreadsheet = await this.config.sheets.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
      includeGridData: false,
    });
    const allSheets = spreadsheet.data.sheets ?? [];

    const existing = allSheets.find((sheet) => sheet.properties?.title === sheetName);
    if (existing) {
      const sheetId = existing.properties?.sheetId;
      if (sheetId == null) {
        throw new Error(`Sheet "${sheetName}" has no sheetId in the Sheets API response`);
      }
      return { sheetId, created: false };
    }

    const template = allSheets.find((sheet) => sheet.properties?.title === TEMPLATE_SHEET_NAME);
    const templateSheetId = template?.properties?.sheetId;
    if (templateSheetId == null) {
      throw new Error(`Template sheet "${TEMPLATE_SHEET_NAME}" not found`);
    }

    const duplicateResponse = await this.config.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.config.spreadsheetId,
      requestBody: {
        requests: [
          {
            duplicateSheet: {
              sourceSheetId: templateSheetId,
              insertSheetIndex: 1,
              newSheetName: sheetName,
            },
          },
        ],
      },
    });
    const newSheetId = duplicateResponse.data.replies?.[0]?.duplicateSheet?.properties?.sheetId;
    if (newSheetId == null) {
      throw new Error(`Duplicating "${TEMPLATE_SHEET_NAME}" didn't return a new sheetId`);
    }
    return { sheetId: newSheetId, created: true };
  }

  private async findTotalOwingRow(sheetName: string): Promise<number> {
    const range = `${quoteSheetName(sheetName)}!${columnLetter(TOTAL_OWING_COLUMN)}2:${columnLetter(TOTAL_OWING_COLUMN)}${1 + MAX_ROWS_TO_SEARCH}`;
    const response = await this.config.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range,
    });
    const values = response.data.values ?? [];
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === 'TOTAL OWING') {
        return i + 2;
      }
    }
    throw new Error(`Could not find "TOTAL OWING" row in sheet "${sheetName}"`);
  }

  private async insertRows(sheetId: number, insertRow: number, rowCount: number): Promise<void> {
    const startIndex = insertRow - 1;
    await this.config.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.config.spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex, endIndex: startIndex + rowCount },
              // Safe: insertRow is always >= 3 (row 1 is the header, row 2+
              // is where the first transaction or TOTAL OWING itself would
              // be), so there's always a preceding row to inherit from.
              inheritFromBefore: true,
            },
          },
        ],
      },
    });
  }

  private async writeRowValues(sheetName: string, insertRow: number, rows: string[][]): Promise<void> {
    const lastRow = insertRow + rows.length - 1;
    const range = `${quoteSheetName(sheetName)}!A${insertRow}:D${lastRow}`;
    await this.config.sheets.spreadsheets.values.update({
      spreadsheetId: this.config.spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { range, values: rows },
    });
  }

  private async finalizeAddedRows(
    sheetName: string,
    insertRow: number,
    rowCount: number,
    rowPercentages?: (Record<string, number> | null)[],
  ): Promise<void> {
    const response = await this.config.script.scripts.run({
      scriptId: this.config.scriptId,
      requestBody: {
        function: FINALIZE_FUNCTION_NAME,
        parameters: [sheetName, insertRow, rowCount, rowPercentages ?? null],
      },
    });
    if (response.data.error) {
      const detail = response.data.error.message ?? JSON.stringify(response.data.error.details ?? {});
      throw new Error(`${FINALIZE_FUNCTION_NAME} failed: ${detail}`);
    }
  }

  /**
   * Best-effort compensating cleanup for when finalizeAddedRows fails after
   * the Sheets API write already succeeded — there's no real cross-API
   * transaction available. Never swallows the original failure: rethrows it
   * on rollback success, or throws a combined error naming both failures.
   */
  private async rollback(
    sheetId: number,
    sheetWasCreated: boolean,
    insertRow: number,
    rowCount: number,
    finalizeError: unknown,
  ): Promise<never> {
    try {
      if (sheetWasCreated) {
        await this.config.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.config.spreadsheetId,
          requestBody: { requests: [{ deleteSheet: { sheetId } }] },
        });
      } else {
        const startIndex = insertRow - 1;
        await this.config.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.config.spreadsheetId,
          requestBody: {
            requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex, endIndex: startIndex + rowCount } } } ],
          },
        });
      }
    } catch (rollbackError) {
      throw new Error(
        `finalizeAddedRows failed (${errorMessage(finalizeError)}), and the compensating rollback also failed (${errorMessage(rollbackError)}) — the sheet may be left with un-finalized rows.`,
        { cause: rollbackError },
      );
    }
    throw finalizeError instanceof Error ? finalizeError : new Error(errorMessage(finalizeError));
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Quotes a sheet name for A1 notation, escaping embedded single quotes. */
function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

/** 1-indexed column number -> A1 column letter(s), e.g. 4 -> "D". */
function columnLetter(column: number): string {
  let n = column;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function loadSheetsClientConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Omit<SheetsClientConfig, 'sheets' | 'script'> {
  const spreadsheetId = env.SPREADSHEET_ID;
  const scriptId = env.APPS_SCRIPT_SCRIPT_ID;
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!spreadsheetId) {
    throw new Error('Missing SPREADSHEET_ID environment variable');
  }
  if (!scriptId) {
    throw new Error('Missing APPS_SCRIPT_SCRIPT_ID environment variable');
  }
  if (!clientId) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID environment variable');
  }
  if (!clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_SECRET environment variable');
  }
  return { spreadsheetId, scriptId };
}

export function defaultSheetsClient(env: NodeJS.ProcessEnv = process.env): SheetsClient {
  const { spreadsheetId, scriptId } = loadSheetsClientConfigFromEnv(env);
  const auth = loadSavedCredentialsOrThrow(env.GOOGLE_OAUTH_CLIENT_ID!, env.GOOGLE_OAUTH_CLIENT_SECRET!);
  return new SheetsClient({
    spreadsheetId,
    scriptId,
    sheets: new sheets_v4.Sheets({ auth }),
    script: new script_v1.Script({ auth }),
  });
}
