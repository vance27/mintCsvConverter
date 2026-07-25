import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Where retained source receipt PDFs live — the review UI (Phase 3) shows one alongside its split form. Overridable for tests. */
export function defaultReceiptsBaseDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  return `${home}/.config/mint-csv-converter/receipts`;
}

/** Copies a receipt PDF into permanent storage, keyed by content hash (idempotent — re-ingesting overwrites the same destination). */
export function retainReceiptSource(pdfPath: string, sha256: string, baseDir: string = defaultReceiptsBaseDir()): string {
  const destination = join(baseDir, `${sha256}.pdf`);
  mkdirSync(baseDir, { recursive: true });
  copyFileSync(pdfPath, destination);
  return destination;
}
