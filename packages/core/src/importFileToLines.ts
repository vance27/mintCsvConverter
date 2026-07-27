import { applyColumnMapping, CITI_DEFAULT_MAPPING, type CsvColumnMapping } from './csvColumnMapping.js';
import { readRawCsvGrid } from './rawCsvGrid.js';

/**
 * Reads a CSV file and normalizes it to [date, description, '', amount]
 * rows, per the given column mapping (Citi's [Status, Date, Description,
 * Debit, Credit, Member Name] layout by default — see CITI_DEFAULT_MAPPING).
 * Pass a different CsvColumnMapping to import a differently-shaped export.
 */
export class ImportFileToLines {
  constructor(
    private readonly file: string,
    private readonly mapping: CsvColumnMapping = CITI_DEFAULT_MAPPING,
  ) {}

  getResults(): string[][] {
    console.log('Importing file, converting to lines');
    return applyColumnMapping(readRawCsvGrid(this.file), this.mapping);
  }
}
