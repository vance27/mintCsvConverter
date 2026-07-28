import { describe, it, expect } from 'vitest';
import { setActiveSpreadsheetForTest, resetScriptPropertiesForTest } from './testing/fakeGasGlobals.js';
import { FakeSpreadsheet } from './testing/fakeSheet.js';
import { finalizeAddedRows } from './syncApi.js';

const TEMPLATE_ROWS = [
    ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'], // row 1
    ['Chipotle Mexican Grill 07/01/2026', 'Brian', 28.18, 'Equally'], // row 2 (participant columns not yet defaulted)
    ['', '', '', 'TOTAL OWING'], // row 3 (anchor = 2)
    ['', '', '', true], // row 4: simplify toggle
];

describe('finalizeAddedRows', () => {
    it('applies checkbox/percent defaulting and recalculates settle-up for the given row range', () => {
        resetScriptPropertiesForTest();
        const spreadsheet = new FakeSpreadsheet();
        const sheet = spreadsheet.addSheet(
            'Brian 07/26',
            TEMPLATE_ROWS.map((row) => [...row]),
        );
        setActiveSpreadsheetForTest(spreadsheet);

        finalizeAddedRows('Brian 07/26', 2, 1);

        // Row 2 (index 1): checkbox defaults applied by onSplitTypeChanged.
        expect(sheet.grid[1][4]).toBe(true);
        expect(sheet.grid[1][5]).toBe(true);
        // Settle-up recalculated: Brian paid $28.18 split equally between both
        // (checked) participants -> Patrice owes Brian $14.09 (half), written
        // under Patrice's column (F, index 5) on the "TOTAL OWING" row itself
        // (row 3, index 2).
        expect(sheet.grid[2][5]).toBe('Brian $14.09');

        setActiveSpreadsheetForTest(undefined);
    });

    it('finalizes every row in a multi-row range', () => {
        resetScriptPropertiesForTest();
        const spreadsheet = new FakeSpreadsheet();
        const sheet = spreadsheet.addSheet('Brian 07/26', [
            ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
            ['Chipotle', 'Brian', 20, 'Variably'],
            ['Costco', 'Brian', 10, 'Variably'],
            ['', '', '', 'TOTAL OWING'],
            ['', '', '', true],
        ]);
        setActiveSpreadsheetForTest(spreadsheet);

        finalizeAddedRows('Brian 07/26', 2, 2);

        expect(sheet.grid[1][4]).toBe('50%');
        expect(sheet.grid[1][5]).toBe('50%');
        expect(sheet.grid[2][4]).toBe('50%');
        expect(sheet.grid[2][5]).toBe('50%');

        setActiveSpreadsheetForTest(undefined);
    });

    it('writes manifest-matched percentages instead of the even default, and still defaults unmatched rows', () => {
        resetScriptPropertiesForTest();
        const spreadsheet = new FakeSpreadsheet();
        const sheet = spreadsheet.addSheet('Brian 07/26', [
            ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
            ['Costco 07/01/2026', 'Brian', 150, 'Variably'],
            ['Target 07/02/2026', 'Brian', 40, 'Variably'],
            ['', '', '', 'TOTAL OWING'],
            ['', '', '', true],
        ]);
        setActiveSpreadsheetForTest(spreadsheet);

        finalizeAddedRows('Brian 07/26', 2, 2, [{ Brian: 62, Patrice: 38 }, null]);

        // Row 2: real manifest match, written directly (not the even default).
        expect(sheet.grid[1][4]).toBe('62%');
        expect(sheet.grid[1][5]).toBe('38%');
        // Row 3: no match (null) -> falls back to onSplitTypeChanged's default.
        expect(sheet.grid[2][4]).toBe('50%');
        expect(sheet.grid[2][5]).toBe('50%');

        setActiveSpreadsheetForTest(undefined);
    });

    it('falls back to the even default when a percentages entry has an unknown participant', () => {
        resetScriptPropertiesForTest();
        const spreadsheet = new FakeSpreadsheet();
        const sheet = spreadsheet.addSheet('Brian 07/26', [
            ['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice'],
            ['Costco 07/01/2026', 'Brian', 150, 'Variably'],
            ['', '', '', 'TOTAL OWING'],
            ['', '', '', true],
        ]);
        setActiveSpreadsheetForTest(spreadsheet);

        finalizeAddedRows('Brian 07/26', 2, 1, [{ Brian: 62, Someone: 38 }]);

        expect(sheet.grid[1][4]).toBe('50%');
        expect(sheet.grid[1][5]).toBe('50%');

        setActiveSpreadsheetForTest(undefined);
    });

    it('throws when no sheet with that name exists', () => {
        resetScriptPropertiesForTest();
        const spreadsheet = new FakeSpreadsheet();
        setActiveSpreadsheetForTest(spreadsheet);

        expect(() => finalizeAddedRows('Brian 07/26', 2, 1)).toThrow(/Sheet "Brian 07\/26" not found/);

        setActiveSpreadsheetForTest(undefined);
    });
});
