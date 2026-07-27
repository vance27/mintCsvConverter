import { z } from 'zod';
import type { PayerExclusionRule } from './generated/prisma/client.js';
import type { PrismaClient } from './db.js';

export const createPayerExclusionRuleSchema = z.object({
  payer: z.string().min(1),
  pattern: z.string().min(1),
  note: z.string().optional(),
});
export type CreatePayerExclusionRuleInput = z.infer<typeof createPayerExclusionRuleSchema>;

export function listPayerExclusionRules(prisma: PrismaClient): Promise<PayerExclusionRule[]> {
  return prisma.payerExclusionRule.findMany({ orderBy: [{ payer: 'asc' }, { pattern: 'asc' }] });
}

/** Stores `payer` uppercased, matching CsvConverterFactory.isValidLine's `name.toUpperCase()` lookup key. */
export function createPayerExclusionRule(prisma: PrismaClient, input: CreatePayerExclusionRuleInput): Promise<PayerExclusionRule> {
  return prisma.payerExclusionRule.create({
    data: { payer: input.payer.toUpperCase(), pattern: input.pattern, note: input.note },
  });
}

export async function deletePayerExclusionRule(prisma: PrismaClient, id: number): Promise<void> {
  await prisma.payerExclusionRule.delete({ where: { id } });
}

/** Groups every rule by uppercased payer into the exact shape CsvConverterFactory.personalExclusions expects. */
export async function loadPersonalExclusionsDict(prisma: PrismaClient): Promise<Record<string, string[]>> {
  const rules = await prisma.payerExclusionRule.findMany();
  const dict: Record<string, string[]> = {};
  for (const rule of rules) {
    (dict[rule.payer] ??= []).push(rule.pattern);
  }
  return dict;
}
