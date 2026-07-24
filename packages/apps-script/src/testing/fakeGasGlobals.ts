import { FakeSpreadsheet } from './fakeSheet.js';

// Apps Script code references SpreadsheetApp/Logger/PropertiesService/
// ContentService as bare ambient globals (that's how real Apps Script code
// is written — there's nothing to import). To run that code under Node for
// tests, we stub the same names on globalThis. Call installFakeGasGlobals()
// BEFORE dynamically importing any module under test (top-level `await
// import(...)`, not a static `import` — static imports are hoisted and
// would run before this setup call executes), since some modules (e.g.
// sheetLayout.ts) call SpreadsheetApp.newDataValidation() at module load
// time to build their exported validation-rule constants.

let activeSpreadsheet: FakeSpreadsheet | undefined;
let scriptProperties: Record<string, string> = {};

export function installFakeGasGlobals(): void {
  const g = globalThis as Record<string, unknown>;

  g.Logger = {
    log: (..._args: unknown[]) => {
      // Intentionally silent in tests.
    },
  };

  g.SpreadsheetApp = {
    newDataValidation: () => {
      const builder = {
        requireCheckbox: () => builder,
        requireFormulaSatisfied: (_formula: string) => builder,
        build: () => ({ __fakeDataValidation: true }),
      };
      return builder;
    },
    getActiveSpreadsheet: () => {
      if (!activeSpreadsheet) {
        throw new Error('Call setActiveSpreadsheetForTest() before code that uses SpreadsheetApp.getActiveSpreadsheet()');
      }
      return activeSpreadsheet.asSpreadsheet();
    },
  };

  g.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key: string) => scriptProperties[key] ?? null,
    }),
  };

  g.ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text: string) => {
      let mimeType: string | undefined;
      const output = {
        getContent: () => text,
        getMimeType: () => mimeType,
        setMimeType(type: string) {
          mimeType = type;
          return output;
        },
      };
      return output;
    },
  };
}

/** Controls what `SpreadsheetApp.getActiveSpreadsheet()` returns in tests. */
export function setActiveSpreadsheetForTest(spreadsheet: FakeSpreadsheet | undefined): void {
  activeSpreadsheet = spreadsheet;
}

/** Controls what `PropertiesService.getScriptProperties().getProperty(key)` returns in tests. */
export function setScriptPropertyForTest(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete scriptProperties[key];
  } else {
    scriptProperties[key] = value;
  }
}

/** Clears all script properties set via setScriptPropertyForTest. */
export function resetScriptPropertiesForTest(): void {
  scriptProperties = {};
}
