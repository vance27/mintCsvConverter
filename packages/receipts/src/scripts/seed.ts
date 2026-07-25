import { getPrisma } from '../db.js';
import { seedParticipants } from '../seed.js';

// One-time setup: ensures the given participants exist (active) before any
// ingest run — ingestReceipt deliberately throws on an unknown payer name
// rather than silently creating one, to avoid a typo quietly becoming a new
// "participant." Run once per machine, or whenever adding a new participant:
//
//   nx run @mint-csv-converter/receipts:seed -- Brian Patrice

async function main(): Promise<void> {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error('Usage: seed.ts <participant-name...>');
    process.exitCode = 1;
    return;
  }

  const prisma = getPrisma();
  await seedParticipants(prisma, names);
  console.log(`Seeded participant(s): ${names.join(', ')}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
