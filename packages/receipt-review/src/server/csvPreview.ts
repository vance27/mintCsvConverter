import { readRawCsvGrid } from '@mint-csv-converter/core';
import { findMatchingCsvImportProfile, type CsvImportProfileView, type PrismaClient } from '@mint-csv-converter/receipts';

export interface CsvPreview {
  /** First ~20 raw rows, with no header/column-role assumption — for the configurator's preview grid. */
  rows: string[][];
  columnCount: number;
  /** Normalized (lowercased/trimmed, comma-joined) row 0, assuming it's a header — null only for a fully empty file. */
  headerSignature: string | null;
  detectedProfile: CsvImportProfileView | null;
}

const PREVIEW_ROW_LIMIT = 20;

function normalizeHeaderRow(row: string[]): string {
  return row.map((cell) => cell.trim().toLowerCase()).join(',');
}

/**
 * Previews a raw CSV before any import commitment: shows the grid as-is
 * and tries to auto-detect a saved CsvImportProfile — first via an exact
 * headerSignature match (assuming row 0 is a header, the strong signal),
 * falling back to a hasHeader:false + columnCount match (for a
 * previously-saved headerless profile of the same shape) if that misses.
 * A miss on both means this is a genuinely new CSV shape, needing the
 * configurator.
 */
export async function previewCsvImport(prisma: PrismaClient, csvPath: string): Promise<CsvPreview> {
  const grid = readRawCsvGrid(csvPath);
  const columnCount = grid[0]?.length ?? 0;
  const headerSignature = grid[0] ? normalizeHeaderRow(grid[0]) : null;

  const detectedProfile =
    (headerSignature !== null
      ? await findMatchingCsvImportProfile(prisma, { hasHeader: true, headerSignature, columnCount })
      : null) ?? (await findMatchingCsvImportProfile(prisma, { hasHeader: false, headerSignature: null, columnCount }));

  return { rows: grid.slice(0, PREVIEW_ROW_LIMIT), columnCount, headerSignature, detectedProfile };
}
