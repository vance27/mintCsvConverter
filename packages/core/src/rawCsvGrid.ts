import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

/** Parses a CSV file into its raw grid of cells, with no header or column-role assumption — for previewing a never-before-seen CSV shape before choosing a CsvColumnMapping for it. */
export function readRawCsvGrid(file: string): string[][] {
  const content = readFileSync(file, 'utf-8');
  return parse(content);
}
