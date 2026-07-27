import { describe, it, expect, afterEach } from 'vitest';
import {
  listVariableSplitRules,
  createVariableSplitRule,
  deleteVariableSplitRule,
  loadVariableSplitPatterns,
} from './variableSplitRules.js';
import { createTestDb } from './testing/testDb.js';

describe('variableSplitRules', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function db() {
    const { prisma, cleanup } = createTestDb();
    cleanups.push(cleanup);
    return prisma;
  }

  it('seeds today\'s hardcoded VARIABLE vendor list via the add_csv_rule_tables migration', async () => {
    const prisma = db();
    const patterns = await loadVariableSplitPatterns(prisma);
    expect(patterns).toEqual(expect.arrayContaining(['Costco', 'TARGET']));
  });

  it('creates and lists a new pattern, sorted', async () => {
    const prisma = db();
    await prisma.variableSplitRule.deleteMany();
    await createVariableSplitRule(prisma, { pattern: 'Whole Foods' });
    await createVariableSplitRule(prisma, { pattern: 'Amazon' });

    const rules = await listVariableSplitRules(prisma);
    expect(rules.map((r) => r.pattern)).toEqual(['Amazon', 'Whole Foods']);
  });

  it('deletes a pattern by id', async () => {
    const prisma = db();
    const rule = await createVariableSplitRule(prisma, { pattern: 'TEMP VENDOR' });
    await deleteVariableSplitRule(prisma, rule.id);

    const patterns = await loadVariableSplitPatterns(prisma);
    expect(patterns).not.toContain('TEMP VENDOR');
  });

  it('loads patterns ready to assign to CsvConverterFactory.splitRulesDict.VARIABLE', async () => {
    const prisma = db();
    const patterns = await loadVariableSplitPatterns(prisma);
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.every((p) => typeof p === 'string')).toBe(true);
  });
});
