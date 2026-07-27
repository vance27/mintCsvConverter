import { describe, it, expect, afterEach } from 'vitest';
import {
  listCsvImportProfiles,
  createCsvImportProfile,
  deleteCsvImportProfile,
  findMatchingCsvImportProfile,
  type CreateCsvImportProfileInput,
} from './csvImportProfiles.js';
import { createTestDb } from './testing/testDb.js';

const CITI_LIKE_PROFILE: CreateCsvImportProfileInput = {
  name: 'Citi',
  hasHeader: true,
  columnCount: 6,
  headerSignature: 'status,date,description,debit,credit,member name',
  columnMapping: {
    hasHeader: true,
    dateColumn: { byName: 'date' },
    descriptionColumn: { byName: 'description' },
    amount: { mode: 'DEBIT_CREDIT', debitColumn: { byName: 'debit' }, creditColumn: { byName: 'credit' } },
  },
};

const HEADERLESS_PROFILE: CreateCsvImportProfileInput = {
  name: 'Headerless bank export',
  hasHeader: false,
  columnCount: 3,
  headerSignature: null,
  columnMapping: {
    hasHeader: false,
    dateColumn: { byIndex: 0 },
    descriptionColumn: { byIndex: 1 },
    amount: { mode: 'SIGNED_AMOUNT', amountColumn: { byIndex: 2 }, flipSign: false },
  },
};

describe('csvImportProfiles', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function db() {
    const { prisma, cleanup } = createTestDb();
    cleanups.push(cleanup);
    return prisma;
  }

  it('creates and lists a profile, round-tripping the column mapping through JSON', async () => {
    const prisma = db();
    const created = await createCsvImportProfile(prisma, CITI_LIKE_PROFILE);
    expect(created.columnMapping).toEqual(CITI_LIKE_PROFILE.columnMapping);

    const listed = await listCsvImportProfiles(prisma);
    expect(listed.map((p) => p.name)).toEqual(['Citi']);
  });

  it('deletes a profile by id', async () => {
    const prisma = db();
    const created = await createCsvImportProfile(prisma, CITI_LIKE_PROFILE);
    await deleteCsvImportProfile(prisma, created.id);
    expect(await listCsvImportProfiles(prisma)).toEqual([]);
  });

  it('matches an exact headerSignature (strong signal) and bumps lastUsedAt', async () => {
    const prisma = db();
    const created = await createCsvImportProfile(prisma, CITI_LIKE_PROFILE);
    expect(created.lastUsedAt).toBeNull();

    const match = await findMatchingCsvImportProfile(prisma, {
      hasHeader: true,
      headerSignature: 'status,date,description,debit,credit,member name',
      columnCount: 6,
    });
    expect(match?.id).toBe(created.id);
    expect(match?.lastUsedAt).not.toBeNull();
  });

  it('falls back to hasHeader+columnCount for headerless CSVs (weak signal)', async () => {
    const prisma = db();
    const created = await createCsvImportProfile(prisma, HEADERLESS_PROFILE);

    const match = await findMatchingCsvImportProfile(prisma, { hasHeader: false, headerSignature: null, columnCount: 3 });
    expect(match?.id).toBe(created.id);
  });

  it('returns null when nothing matches', async () => {
    const prisma = db();
    await createCsvImportProfile(prisma, CITI_LIKE_PROFILE);

    const match = await findMatchingCsvImportProfile(prisma, { hasHeader: true, headerSignature: 'totally,different,header', columnCount: 3 });
    expect(match).toBeNull();
  });
});
