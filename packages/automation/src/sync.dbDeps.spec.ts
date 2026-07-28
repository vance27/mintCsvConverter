import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '@mint-csv-converter/receipts/dist/testing/testDb.js';
import { loadDbBackedFactory } from './sync.js';

describe('loadDbBackedFactory', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    it("populates the factory's personalExclusions/splitRulesDict from the DB (seeded from CsvConverterFactory's old hardcoded defaults)", async () => {
        const { prisma, cleanup } = createTestDb();
        cleanups.push(cleanup);

        const factory = await loadDbBackedFactory(prisma);

        expect(factory.personalExclusions.BRIAN).toContain('CITI CARD');
        expect(factory.personalExclusions.PATRICE).toContain('CVS/SPECIALTY');
        expect(factory.splitRulesDict.VARIABLE).toEqual(expect.arrayContaining(['Costco', 'TARGET']));
    });

    it('still throws for an unregistered payer, matching the pre-DB contract', async () => {
        const { prisma, cleanup } = createTestDb();
        cleanups.push(cleanup);

        const factory = await loadDbBackedFactory(prisma);

        expect(() => factory.isValidLine(['06/20/2026', 'Some vendor', '', '10.00'], 'Zzz')).toThrow(
            /No personal exclusions configured/,
        );
    });

    it('reflects a newly-added rule immediately', async () => {
        const { prisma, cleanup } = createTestDb();
        cleanups.push(cleanup);
        await prisma.payerExclusionRule.create({ data: { payer: 'BRIAN', pattern: 'NEW TEST VENDOR' } });

        const factory = await loadDbBackedFactory(prisma);

        expect(factory.isValidLine(['06/20/2026', 'NEW TEST VENDOR PURCHASE', '', '10.00'], 'Brian')).toBe(false);
    });
});

// Note: defaultSyncDeps' loadManifestEntries wiring (`() =>
// listManifestEntries(prisma)`) is intentionally not tested by calling
// defaultSyncDeps() itself here — that also builds a real Sheets client via
// defaultSheetsClient(), which reads saved OAuth credentials from disk and
// would only pass on a machine that already has them (not hermetic, unlike
// every other test in this suite). listManifestEntries' own behavior is
// fully covered by packages/receipts' receiptManifest.spec.ts, and runSync's
// use of deps.loadManifestEntries() is covered by sync.spec.ts's
// fake-deps tests.
