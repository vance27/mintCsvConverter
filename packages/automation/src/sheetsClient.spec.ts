import { describe, it, expect, vi } from 'vitest';
import { SheetsClient, type SpreadsheetsClient, type ScriptClient } from './sheetsClient.js';

const SPREADSHEET_ID = 'spreadsheet-1';
const SCRIPT_ID = 'script-1';

interface FakeSheetsOptions {
  sheets?: { title: string; sheetId: number }[];
  /** 1-indexed row number where "TOTAL OWING" sits; null means no marker row present at all. */
  totalOwingRow?: number | null;
}

function makeFakeSheets(options: FakeSheetsOptions = {}): SpreadsheetsClient & {
  batchUpdate: ReturnType<typeof vi.fn>;
  values: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
} {
  const sheets = options.sheets ?? [{ title: 'DUPLICATE ME', sheetId: 100 }];
  const totalOwingRow = options.totalOwingRow === undefined ? 2 : options.totalOwingRow;

  const get = vi.fn(async () => ({
    data: { sheets: sheets.map((s) => ({ properties: { title: s.title, sheetId: s.sheetId } })) },
  }));

  const batchUpdate = vi.fn(async (params: { requestBody?: { requests?: unknown[] } }) => {
    const request = params.requestBody?.requests?.[0] as { duplicateSheet?: unknown } | undefined;
    if (request?.duplicateSheet) {
      return { data: { replies: [{ duplicateSheet: { properties: { sheetId: 999 } } }] } };
    }
    return { data: {} };
  });

  const valuesGet = vi.fn(async () => {
    if (totalOwingRow === null) {
      return { data: { values: [] } };
    }
    const values: string[][] = [];
    for (let i = 0; i < totalOwingRow - 1; i++) {
      values.push(i === totalOwingRow - 2 ? ['TOTAL OWING'] : ['']);
    }
    return { data: { values } };
  });

  const valuesUpdate = vi.fn(async () => ({ data: {} }));

  return {
    get,
    batchUpdate,
    values: { get: valuesGet, update: valuesUpdate },
  };
}

function makeFakeScript(error?: { message: string }): ScriptClient & { scripts: { run: ReturnType<typeof vi.fn> } } {
  const run = vi.fn(async () => ({ data: error ? { error } : {} }));
  return { scripts: { run } };
}

describe('SheetsClient.addTransactionsForPeriod', () => {
  it('writes rows into an existing sheet and finalizes them', async () => {
    const fakeSheets = makeFakeSheets({ sheets: [{ title: 'Brian 07/26', sheetId: 5 }], totalOwingRow: 4 });
    const fakeScript = makeFakeScript();
    const client = new SheetsClient({ spreadsheetId: SPREADSHEET_ID, scriptId: SCRIPT_ID, sheets: { spreadsheets: fakeSheets }, script: fakeScript });

    const result = await client.addTransactionsForPeriod({
      payerName: 'Brian',
      periodLabel: '07/26',
      rows: [['Chipotle 07/01/2026', 'Brian', '28.18', 'Equally']],
    });

    expect(result).toEqual({ sheetName: 'Brian 07/26', rowsAdded: 1 });
    // batchUpdate is still called once, for insertDimension — just never
    // with a duplicateSheet request, since the sheet already existed.
    expect(fakeSheets.batchUpdate).toHaveBeenCalledTimes(1);
    expect(fakeSheets.batchUpdate).not.toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining/anything are `any`-typed by design
      expect.objectContaining({ requestBody: expect.objectContaining({ requests: [expect.objectContaining({ duplicateSheet: expect.anything() })] }) }),
    );
    expect(fakeSheets.values.update).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: SPREADSHEET_ID,
        range: "'Brian 07/26'!A4:D4",
        valueInputOption: 'USER_ENTERED',
      }),
    );
    expect(fakeScript.scripts.run).toHaveBeenCalledWith({
      scriptId: SCRIPT_ID,
      requestBody: { function: 'finalizeAddedRows', parameters: ['Brian 07/26', 4, 1] },
    });
  });

  it('creates a new sheet by duplicating "DUPLICATE ME" when none exists', async () => {
    const fakeSheets = makeFakeSheets({ totalOwingRow: 2 });
    const fakeScript = makeFakeScript();
    const client = new SheetsClient({ spreadsheetId: SPREADSHEET_ID, scriptId: SCRIPT_ID, sheets: { spreadsheets: fakeSheets }, script: fakeScript });

    const result = await client.addTransactionsForPeriod({
      payerName: 'Brian',
      periodLabel: '07/26',
      rows: [['Chipotle', 'Brian', '28.18', 'Equally']],
    });

    expect(result).toEqual({ sheetName: 'Brian 07/26', rowsAdded: 1 });
    expect(fakeSheets.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: {
          requests: [{ duplicateSheet: { sourceSheetId: 100, insertSheetIndex: 1, newSheetName: 'Brian 07/26' } }],
        },
      }),
    );
  });

  it('throws when no existing sheet and no "DUPLICATE ME" template', async () => {
    const fakeSheets = makeFakeSheets({ sheets: [] });
    const fakeScript = makeFakeScript();
    const client = new SheetsClient({ spreadsheetId: SPREADSHEET_ID, scriptId: SCRIPT_ID, sheets: { spreadsheets: fakeSheets }, script: fakeScript });

    await expect(
      client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [['x', 'Brian', '1', 'Equally']] }),
    ).rejects.toThrow(/Template sheet "DUPLICATE ME" not found/);
  });

  it('does nothing beyond finding/creating the sheet when rows is empty', async () => {
    const fakeSheets = makeFakeSheets({ sheets: [{ title: 'Brian 07/26', sheetId: 5 }] });
    const fakeScript = makeFakeScript();
    const client = new SheetsClient({ spreadsheetId: SPREADSHEET_ID, scriptId: SCRIPT_ID, sheets: { spreadsheets: fakeSheets }, script: fakeScript });

    const result = await client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [] });

    expect(result).toEqual({ sheetName: 'Brian 07/26', rowsAdded: 0 });
    expect(fakeSheets.values.get).not.toHaveBeenCalled();
    expect(fakeSheets.values.update).not.toHaveBeenCalled();
    expect(fakeScript.scripts.run).not.toHaveBeenCalled();
  });

  it('throws when no "TOTAL OWING" row is found', async () => {
    const fakeSheets = makeFakeSheets({ sheets: [{ title: 'Brian 07/26', sheetId: 5 }], totalOwingRow: null });
    const fakeScript = makeFakeScript();
    const client = new SheetsClient({ spreadsheetId: SPREADSHEET_ID, scriptId: SCRIPT_ID, sheets: { spreadsheets: fakeSheets }, script: fakeScript });

    await expect(
      client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [['x', 'Brian', '1', 'Equally']] }),
    ).rejects.toThrow(/Could not find "TOTAL OWING" row/);
  });

  describe('rollback on a finalize failure', () => {
    it('deletes only the inserted row range when the sheet already existed', async () => {
      const fakeSheets = makeFakeSheets({ sheets: [{ title: 'Brian 07/26', sheetId: 5 }], totalOwingRow: 4 });
      const fakeScript = makeFakeScript({ message: 'boom' });
      const client = new SheetsClient({ spreadsheetId: SPREADSHEET_ID, scriptId: SCRIPT_ID, sheets: { spreadsheets: fakeSheets }, script: fakeScript });

      await expect(
        client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [['x', 'Brian', '1', 'Equally']] }),
      ).rejects.toThrow(/finalizeAddedRows failed: boom/);

      expect(fakeSheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: { requests: [{ deleteDimension: { range: { sheetId: 5, dimension: 'ROWS', startIndex: 3, endIndex: 4 } } }] },
        }),
      );
    });

    it('deletes the whole sheet when it was freshly created', async () => {
      const fakeSheets = makeFakeSheets({ totalOwingRow: 2 });
      const fakeScript = makeFakeScript({ message: 'boom' });
      const client = new SheetsClient({ spreadsheetId: SPREADSHEET_ID, scriptId: SCRIPT_ID, sheets: { spreadsheets: fakeSheets }, script: fakeScript });

      await expect(
        client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [['x', 'Brian', '1', 'Equally']] }),
      ).rejects.toThrow(/finalizeAddedRows failed: boom/);

      expect(fakeSheets.batchUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ requestBody: { requests: [{ deleteSheet: { sheetId: 999 } }] } }),
      );
    });

    it('reports both failures, without losing the original error, when rollback also fails', async () => {
      const fakeSheets = makeFakeSheets({ sheets: [{ title: 'Brian 07/26', sheetId: 5 }], totalOwingRow: 4 });
      // First call is the legitimate insertDimension (must succeed so we
      // reach the finalize+rollback path); only the rollback's own
      // deleteDimension call (the second) should fail.
      fakeSheets.batchUpdate.mockResolvedValueOnce({ data: {} }).mockRejectedValue(new Error('rollback network error'));
      const fakeScript = makeFakeScript({ message: 'boom' });
      const client = new SheetsClient({ spreadsheetId: SPREADSHEET_ID, scriptId: SCRIPT_ID, sheets: { spreadsheets: fakeSheets }, script: fakeScript });

      await expect(
        client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [['x', 'Brian', '1', 'Equally']] }),
      ).rejects.toThrow(/finalizeAddedRows failed \(finalizeAddedRows failed: boom\).*rollback also failed \(rollback network error\)/s);
    });
  });
});
