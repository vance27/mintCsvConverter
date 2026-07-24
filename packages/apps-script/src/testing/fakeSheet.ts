import type { Sheet, Spreadsheet } from '../types.js';

/**
 * A minimal in-memory stand-in for a single Range returned by
 * FakeSheet.getRange, backed directly by the sheet's own grid so reads
 * see writes made through any other range/cell reference to the same
 * cells (matching real Sheets behavior).
 */
class FakeRange {
  constructor(
    private readonly grid: unknown[][],
    private readonly row: number,
    private readonly col: number,
    private readonly numRows: number,
    private readonly numCols: number,
  ) {}

  getValue(): unknown {
    return this.grid[this.row - 1]?.[this.col - 1] ?? '';
  }

  getValues(): unknown[][] {
    const values: unknown[][] = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowValues: unknown[] = [];
      for (let c = 0; c < this.numCols; c++) {
        rowValues.push(this.grid[this.row - 1 + r]?.[this.col - 1 + c] ?? '');
      }
      values.push(rowValues);
    }
    return values;
  }

  setValue(value: unknown): this {
    this.ensureRow(this.row);
    this.grid[this.row - 1][this.col - 1] = value;
    return this;
  }

  setValues(values: unknown[][]): this {
    for (let r = 0; r < values.length; r++) {
      this.ensureRow(this.row + r);
      for (let c = 0; c < values[r].length; c++) {
        this.grid[this.row - 1 + r][this.col - 1 + c] = values[r][c];
      }
    }
    return this;
  }

  setDataValidation(_rule: unknown): this {
    // No-op: tests assert on cell values, not validation rules.
    return this;
  }

  clear(_options?: { contentsOnly?: boolean }): this {
    for (let r = 0; r < this.numRows; r++) {
      if (this.grid[this.row - 1 + r]) {
        for (let c = 0; c < this.numCols; c++) {
          this.grid[this.row - 1 + r][this.col - 1 + c] = '';
        }
      }
    }
    return this;
  }

  private ensureRow(row1Indexed: number): void {
    while (this.grid.length < row1Indexed) {
      this.grid.push([]);
    }
  }
}

/**
 * A minimal in-memory stand-in for GoogleAppsScript.Spreadsheet.Sheet,
 * implementing only the methods the production code actually calls.
 * Backed by a plain 2D array (`grid`) so tests can set up and assert on
 * sheet state directly, e.g. `new FakeSheet([['Date', 'Description', ...], [...]])`.
 *
 * Cast with `.asSheet()` when passing to production functions, which
 * expect the full ambient `GoogleAppsScript.Spreadsheet.Sheet` type.
 */
export class FakeSheet {
  constructor(
    public grid: unknown[][],
    private name = 'Fake Sheet',
    private spreadsheet?: FakeSpreadsheet,
  ) {}

  getRange(row: number, col: number, numRows = 1, numCols = 1): FakeRange {
    return new FakeRange(this.grid, row, col, numRows, numCols);
  }

  getLastColumn(): number {
    return Math.max(0, ...this.grid.map((row) => row.length));
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): this {
    this.spreadsheet?.renameSheet(this.name, name);
    this.name = name;
    return this;
  }

  insertRowsBefore(beforePosition: number, howMany: number): void {
    const blankRows = Array.from({ length: howMany }, () => [] as unknown[]);
    this.grid.splice(beforePosition - 1, 0, ...blankRows);
  }

  copyTo(spreadsheet: FakeSpreadsheet): FakeSheet {
    const copyName = `Copy of ${this.name}`;
    const copy = new FakeSheet(
      this.grid.map((row) => [...row]),
      copyName,
      spreadsheet,
    );
    spreadsheet.registerSheet(copyName, copy);
    return copy;
  }

  /** Casts this fake to the real ambient Sheet type for passing into production functions. */
  asSheet(): Sheet {
    return this as unknown as Sheet;
  }
}

/**
 * A minimal in-memory stand-in for GoogleAppsScript.Spreadsheet.Spreadsheet,
 * implementing only the methods addTransactionsForPeriod/findOrCreateSheet
 * actually call.
 */
export class FakeSpreadsheet {
  private sheetsByName = new Map<string, FakeSheet>();

  addSheet(name: string, grid: unknown[][] = []): FakeSheet {
    const sheet = new FakeSheet(grid, name, this);
    this.sheetsByName.set(name, sheet);
    return sheet;
  }

  getSheetByName(name: string): FakeSheet | null {
    return this.sheetsByName.get(name) ?? null;
  }

  setActiveSheet(sheet: FakeSheet): FakeSheet {
    return sheet;
  }

  moveActiveSheet(_position: number): void {
    // No-op: tab ordering isn't exercised by these tests.
  }

  /** @internal used by FakeSheet.copyTo */
  registerSheet(name: string, sheet: FakeSheet): void {
    this.sheetsByName.set(name, sheet);
  }

  /** @internal used by FakeSheet.setName */
  renameSheet(oldName: string, newName: string): void {
    const sheet = this.sheetsByName.get(oldName);
    if (sheet) {
      this.sheetsByName.delete(oldName);
      this.sheetsByName.set(newName, sheet);
    }
  }

  /** Casts this fake to the real ambient Spreadsheet type for passing into production functions. */
  asSpreadsheet(): Spreadsheet {
    return this as unknown as Spreadsheet;
  }
}
