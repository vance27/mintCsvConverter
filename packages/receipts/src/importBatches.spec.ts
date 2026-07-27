import { describe, it, expect, afterEach } from 'vitest';
import { listImportBatches, createImportBatch, updateImportBatch, type CreateImportBatchInput } from './importBatches.js';
import { createTestDb } from './testing/testDb.js';

const CITI_JULY_BATCH: CreateImportBatchInput = {
  title: 'Brian — 06/20/2026–07/02/2026',
  description: null,
  payer: 'Brian',
  minDate: '06/20/2026',
  maxDate: '07/02/2026',
  sourceFilename: 'citi_export.csv',
  csvImportProfileId: null,
  importedCount: 3,
  skippedDuplicateCount: 1,
  excludedCount: 2,
};

describe('importBatches', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function db() {
    const { prisma, cleanup } = createTestDb();
    cleanups.push(cleanup);
    return prisma;
  }

  it('creates a batch and lists it back', async () => {
    const prisma = db();
    const created = await createImportBatch(prisma, CITI_JULY_BATCH);
    expect(created.title).toBe(CITI_JULY_BATCH.title);
    expect(created.minDate).toBe('06/20/2026');
    expect(created.maxDate).toBe('07/02/2026');

    const listed = await listImportBatches(prisma);
    expect(listed).toEqual([created]);
  });

  it('lists most-recently-created batch first', async () => {
    const prisma = db();
    const first = await createImportBatch(prisma, { ...CITI_JULY_BATCH, title: 'First' });
    const second = await createImportBatch(prisma, { ...CITI_JULY_BATCH, title: 'Second' });

    const listed = await listImportBatches(prisma);
    expect(listed.map((b) => b.id)).toEqual([second.id, first.id]);
  });

  it('updates title and description independently', async () => {
    const prisma = db();
    const created = await createImportBatch(prisma, CITI_JULY_BATCH);

    const titled = await updateImportBatch(prisma, created.id, { title: 'Renamed' });
    expect(titled.title).toBe('Renamed');
    expect(titled.description).toBeNull();

    const described = await updateImportBatch(prisma, created.id, { description: 'Remember the July return credit' });
    expect(described.title).toBe('Renamed');
    expect(described.description).toBe('Remember the July return credit');
  });
});
