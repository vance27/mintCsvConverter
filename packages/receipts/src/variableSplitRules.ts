import { z } from 'zod';
import type { VariableSplitRule } from './generated/prisma/client.js';
import type { PrismaClient } from './db.js';

export const createVariableSplitRuleSchema = z.object({
  pattern: z.string().min(1),
  note: z.string().optional(),
});
export type CreateVariableSplitRuleInput = z.infer<typeof createVariableSplitRuleSchema>;

export function listVariableSplitRules(prisma: PrismaClient): Promise<VariableSplitRule[]> {
  return prisma.variableSplitRule.findMany({ orderBy: { pattern: 'asc' } });
}

export function createVariableSplitRule(prisma: PrismaClient, input: CreateVariableSplitRuleInput): Promise<VariableSplitRule> {
  return prisma.variableSplitRule.create({ data: { pattern: input.pattern, note: input.note } });
}

export async function deleteVariableSplitRule(prisma: PrismaClient, id: number): Promise<void> {
  await prisma.variableSplitRule.delete({ where: { id } });
}

/** Ready to assign directly to CsvConverterFactory.splitRulesDict.VARIABLE. */
export async function loadVariableSplitPatterns(prisma: PrismaClient): Promise<string[]> {
  const rules = await prisma.variableSplitRule.findMany();
  return rules.map((rule) => rule.pattern);
}
