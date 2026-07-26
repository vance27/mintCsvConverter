import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ManifestEntry {
  receiptId: number;
  store: string;
  payer: string;
  /** The amount that will actually match a Citi CSV transaction — see packages/receipts' tender.ts. */
  cardAmount: number;
  /** ISO date (YYYY-MM-DD) — used as a tiebreak when multiple entries share a cardAmount. */
  purchaseDate: string;
  percentages: Record<string, number>;
}

export interface Manifest {
  version: 1;
  entries: ManifestEntry[];
}

/** Where Phase 4's future sync step will read this from — same ~/.config/mint-csv-converter/ convention as the datastore and retained PDFs. */
export function defaultManifestPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  return `${home}/.config/mint-csv-converter/receipt-manifest.json`;
}

export function readManifest(path: string = defaultManifestPath()): Manifest {
  if (!existsSync(path)) {
    return { version: 1, entries: [] };
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
}

/** Upserts by receiptId (idempotent re-submits replace the prior entry rather than duplicating it). */
export function appendManifestEntry(entry: ManifestEntry, path: string = defaultManifestPath()): string {
  const manifest = readManifest(path);
  const existingIndex = manifest.entries.findIndex((e) => e.receiptId === entry.receiptId);
  if (existingIndex >= 0) {
    manifest.entries[existingIndex] = entry;
  } else {
    manifest.entries.push(entry);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return path;
}
