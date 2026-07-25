import { getPrisma } from '../db.js';
import { restoreFromFile } from '../restore.js';
import { defaultSnapshotPath } from '../snapshot.js';

// Rebuilds the datastore from the git-tracked JSON backup — wipes all
// tables and re-inserts from the snapshot. Used to recover a corrupted/lost
// local DB, or to bootstrap a fresh machine:
//
//   nx run @mint-csv-converter/receipts:restore

async function main(): Promise<void> {
  const prisma = getPrisma();
  await restoreFromFile(prisma);
  console.log(`Restored datastore from ${defaultSnapshotPath()}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
