import { getPrisma } from '../db.js';
import { createSnapshot, writeSnapshotFile, defaultSnapshotPath } from '../snapshot.js';

// Writes the current datastore to the local JSON backup (gitignored — see
// costco-receipt-importer.md). Run manually, or via `ingest.ts --snapshot`
// right after an ingest run:
//
//   nx run @mint-csv-converter/receipts:snapshot

async function main(): Promise<void> {
    const prisma = getPrisma();
    const snapshot = await createSnapshot(prisma);
    writeSnapshotFile(snapshot);
    console.log(`Wrote snapshot to ${defaultSnapshotPath()}`);
    await prisma.$disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
