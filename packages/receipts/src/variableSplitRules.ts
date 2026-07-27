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

export const updateVariableSplitRuleSchema = z
  .object({
    pattern: z.string().min(1).optional(),
    note: z.string().optional(),
  })
  .refine((v) => v.pattern !== undefined || v.note !== undefined, {
    message: 'At least one of pattern or note must be provided',
  });
export type UpdateVariableSplitRuleInput = z.infer<typeof updateVariableSplitRuleSchema>;

export function updateVariableSplitRule(
  prisma: PrismaClient,
  id: number,
  input: UpdateVariableSplitRuleInput,
): Promise<VariableSplitRule> {
  return prisma.variableSplitRule.update({
    where: { id },
    data: {
      ...(input.pattern !== undefined ? { pattern: input.pattern } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  });
}

/** Ready to assign directly to CsvConverterFactory.splitRulesDict.VARIABLE. */
export async function loadVariableSplitPatterns(prisma: PrismaClient): Promise<string[]> {
  const rules = await prisma.variableSplitRule.findMany();
  return rules.map((rule) => rule.pattern);
}
