import { describe, it, expect, afterEach } from 'vitest';
import {
    listPayerExclusionRules,
    createPayerExclusionRule,
    updatePayerExclusionRule,
    deletePayerExclusionRule,
    loadPersonalExclusionsDict,
} from './payerExclusionRules.js';
import { createTestDb } from './testing/testDb.js';

describe('payerExclusionRules', () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    function db() {
        const { prisma, cleanup } = createTestDb();
        cleanups.push(cleanup);
        return prisma;
    }

    it("seeds today's hardcoded defaults via the add_csv_rule_tables migration", async () => {
        const prisma = db();
        const dict = await loadPersonalExclusionsDict(prisma);
        expect(dict.BRIAN).toContain('CITI CARD');
        expect(dict.PATRICE).toContain('CVS/SPECIALTY');
    });

    it('creates a rule with the payer uppercased regardless of input casing', async () => {
        const prisma = db();
        const rule = await createPayerExclusionRule(prisma, { payer: 'brian', pattern: 'NEW VENDOR' });
        expect(rule.payer).toBe('BRIAN');

        const dict = await loadPersonalExclusionsDict(prisma);
        expect(dict.BRIAN).toContain('NEW VENDOR');
    });

    it('lists rules sorted by payer then pattern', async () => {
        const prisma = db();
        await prisma.payerExclusionRule.deleteMany();
        await createPayerExclusionRule(prisma, { payer: 'Brian', pattern: 'ZZZ' });
        await createPayerExclusionRule(prisma, { payer: 'Brian', pattern: 'AAA' });

        const rules = await listPayerExclusionRules(prisma);
        expect(rules.map((r) => r.pattern)).toEqual(['AAA', 'ZZZ']);
    });

    it('deletes a rule by id', async () => {
        const prisma = db();
        const rule = await createPayerExclusionRule(prisma, { payer: 'Brian', pattern: 'TEMP' });
        await deletePayerExclusionRule(prisma, rule.id);

        const dict = await loadPersonalExclusionsDict(prisma);
        expect(dict.BRIAN).not.toContain('TEMP');
    });

    it("updates a rule's payer and/or pattern, uppercasing payer regardless of input casing", async () => {
        const prisma = db();
        const rule = await createPayerExclusionRule(prisma, { payer: 'Brian', pattern: 'OLD PATTERN' });

        const updated = await updatePayerExclusionRule(prisma, rule.id, { payer: 'patrice', pattern: 'NEW PATTERN' });
        expect(updated.payer).toBe('PATRICE');
        expect(updated.pattern).toBe('NEW PATTERN');

        const dict = await loadPersonalExclusionsDict(prisma);
        expect(dict.PATRICE).toContain('NEW PATTERN');
        expect(dict.BRIAN ?? []).not.toContain('OLD PATTERN');
    });

    it('groups every rule by uppercased payer, ready for CsvConverterFactory.personalExclusions', async () => {
        const prisma = db();
        const dict = await loadPersonalExclusionsDict(prisma);
        expect(Object.keys(dict).sort()).toEqual(['BRIAN', 'PATRICE']);
        expect(dict.BRIAN.length).toBeGreaterThan(0);
        expect(dict.PATRICE.length).toBeGreaterThan(0);
    });
});
