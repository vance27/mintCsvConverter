import { parseArgs } from 'node:util';
import { getPrisma } from '../db.js';
import { createOllamaClient } from '../ollamaClient.js';
import { ingestReceipt } from '../ingest.js';
import { createSnapshot, writeSnapshotFile, defaultSnapshotPath } from '../snapshot.js';

// Phase 1 driver — no review UI yet. Prints what was extracted so you can
// eyeball it against the real receipt before any UI/manifest work depends
// on extraction being trustworthy:
//
//   nx run @mint-csv-converter/receipts:ingest -- --store Costco --payer Brian <pdf-path...>
//
// Requires participants to already be seeded (nx run @mint-csv-converter/receipts:seed -- Brian Patrice)
// and a local Ollama server running with a vision model pulled (see README).

const USAGE = `Usage: ingest.ts [--store <name>] [--payer <name>] [--snapshot] <pdf-path...>

  --store      Store name the receipt is from (default: Costco)
  --payer      Participant who paid (default: Brian) — must already be seeded
  --snapshot   After ingesting, write the datastore snapshot (opt-in — see README)`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      store: { type: 'string', default: 'Costco' },
      payer: { type: 'string', default: 'Brian' },
      snapshot: { type: 'boolean', default: false },
    },
  });

  if (positionals.length === 0) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const prisma = getPrisma();
  const client = createOllamaClient();

  for (const pdfPath of positionals) {
    console.log(`\n--- ${pdfPath} ---`);
    const result = await ingestReceipt(pdfPath, { store: values.store, payer: values.payer }, { prisma, client });

    if (result.skipped) {
      console.log(`Already ingested (receipt #${result.receiptId}) — skipped.`);
      continue;
    }

    const [lineItems, tenders, receiptRow] = await Promise.all([
      prisma.lineItem.findMany({
        where: { receiptId: result.receiptId },
        include: { item: true, splits: { include: { participant: true } } },
      }),
      prisma.receiptTender.findMany({ where: { receiptId: result.receiptId } }),
      prisma.receipt.findUniqueOrThrow({ where: { id: result.receiptId } }),
    ]);

    for (const lineItem of lineItems) {
      const splits = lineItem.splits.map((s) => `${s.participant.name} ${s.percent}%`).join(', ');
      const codeLabel = lineItem.rawItemCode ? ` (#${lineItem.rawItemCode})` : '';
      console.log(`  ${lineItem.rawName}${codeLabel}: $${lineItem.lineTotal.toFixed(2)} — ${splits}`);
    }

    const attemptsNote = result.attempts > 1 ? ` (took ${result.attempts} extraction attempts)` : '';
    console.log(`  Reconciled: ${result.reconciled ? 'yes' : 'NO — check this receipt manually'}${attemptsNote}`);
    console.log(`  New items seen for the first time: ${result.newItemCount}`);
    console.log(`  Aggregate split: ${Object.entries(result.aggregate).map(([name, pct]) => `${name} ${pct}%`).join(', ')}`);
    if (tenders.length > 0) {
      console.log(`  Tender: ${tenders.map((t) => `${t.kind} $${t.amount.toFixed(2)}`).join(', ')}`);
    }
    // total is only null for a not-yet-extracted placeholder row — this
    // ingestReceipt call just ran to completion (result.skipped is false),
    // so it's always populated by this point.
    const total = receiptRow.total ?? 0;
    if (result.cardAmount !== total) {
      console.log(`  Card-matched amount: $${result.cardAmount.toFixed(2)} (total $${total.toFixed(2)} — partially paid by non-card tender)`);
    }
  }

  if (values.snapshot) {
    writeSnapshotFile(await createSnapshot(prisma));
    console.log(`\nWrote snapshot to ${defaultSnapshotPath()}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
