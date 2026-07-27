import { z } from 'zod';
import type { CsvImportProfile } from './generated/prisma/client.js';
import type { PrismaClient } from './db.js';

// Structurally mirrors @mint-csv-converter/core's CsvColumnMapping shape
// (ColumnRef/AmountExtraction/CsvColumnMapping in csvColumnMapping.ts) —
// declared independently here rather than imported, since receipts is a
// foundational leaf and can't depend on core (enforced by
// eslint.config.mjs's module-boundary rule). Keep the two in sync by hand
// if either shape changes.
const columnRefSchema = z.union([z.object({ byName: z.string().min(1) }), z.object({ byIndex: z.number().int().nonnegative() })]);

const amountExtractionSchema = z.union([
  z.object({ mode: z.literal('DEBIT_CREDIT'), debitColumn: columnRefSchema, creditColumn: columnRefSchema }),
  z.object({ mode: z.literal('SIGNED_AMOUNT'), amountColumn: columnRefSchema, flipSign: z.boolean() }),
]);

export const csvColumnMappingSchema = z.object({
  hasHeader: z.boolean(),
  dateColumn: columnRefSchema,
  descriptionColumn: columnRefSchema,
  amount: amountExtractionSchema,
});

export type StoredCsvColumnMapping = z.infer<typeof csvColumnMappingSchema>;

export const createCsvImportProfileSchema = z.object({
  name: z.string().min(1),
  hasHeader: z.boolean(),
  columnCount: z.number().int().positive(),
  headerSignature: z.string().nullable(),
  columnMapping: csvColumnMappingSchema,
});
export type CreateCsvImportProfileInput = z.infer<typeof createCsvImportProfileSchema>;

export interface CsvImportProfileView {
  id: number;
  name: string;
  hasHeader: boolean;
  columnCount: number;
  headerSignature: string | null;
  columnMapping: StoredCsvColumnMapping;
  createdAt: string;
  lastUsedAt: string | null;
}

function toView(row: CsvImportProfile): CsvImportProfileView {
  return {
    id: row.id,
    name: row.name,
    hasHeader: row.hasHeader,
    columnCount: row.columnCount,
    headerSignature: row.headerSignature,
    columnMapping: JSON.parse(row.columnMappingJson) as StoredCsvColumnMapping,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

export async function listCsvImportProfiles(prisma: PrismaClient): Promise<CsvImportProfileView[]> {
  const rows = await prisma.csvImportProfile.findMany({ orderBy: { name: 'asc' } });
  return rows.map(toView);
}

export async function createCsvImportProfile(prisma: PrismaClient, input: CreateCsvImportProfileInput): Promise<CsvImportProfileView> {
  const row = await prisma.csvImportProfile.create({
    data: {
      name: input.name,
      hasHeader: input.hasHeader,
      columnCount: input.columnCount,
      headerSignature: input.headerSignature,
      columnMappingJson: JSON.stringify(input.columnMapping),
    },
  });
  return toView(row);
}

export async function deleteCsvImportProfile(prisma: PrismaClient, id: number): Promise<void> {
  await prisma.csvImportProfile.delete({ where: { id } });
}

/**
 * Looks up a saved profile matching a freshly-computed signature: an exact
 * headerSignature match (strong signal) when present, else a hasHeader +
 * columnCount match (weak signal — collisions across genuinely different
 * headerless shapes with the same column count are possible; callers
 * should surface a weak match distinctly rather than silently trusting
 * it), most-recently-used first. Touches lastUsedAt on a hit.
 */
export async function findMatchingCsvImportProfile(
  prisma: PrismaClient,
  criteria: { hasHeader: boolean; headerSignature: string | null; columnCount: number },
): Promise<CsvImportProfileView | null> {
  const where =
    criteria.headerSignature !== null
      ? { headerSignature: criteria.headerSignature }
      : { hasHeader: criteria.hasHeader, columnCount: criteria.columnCount, headerSignature: null };

  const row = await prisma.csvImportProfile.findFirst({ where, orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }] });
  if (!row) {
    return null;
  }

  const updated = await prisma.csvImportProfile.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return toView(updated);
}
