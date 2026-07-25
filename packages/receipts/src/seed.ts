import type { PrismaClient } from './db.js';

/** Idempotently ensures each named participant exists (active by default). */
export async function seedParticipants(prisma: PrismaClient, names: string[]): Promise<void> {
  for (const name of names) {
    await prisma.participant.upsert({ where: { name }, update: {}, create: { name } });
  }
}
