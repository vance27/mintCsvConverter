import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { appendManifestEntry, readManifest, type ManifestEntry } from './manifest.js';

describe('manifest', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
    return {
      receiptId: 1,
      store: 'Costco',
      payer: 'Brian',
      cardAmount: 236.92,
      purchaseDate: '2026-07-14',
      percentages: { Brian: 62, Patrice: 38 },
      ...overrides,
    };
  }

  it('starts empty when no file exists yet', () => {
    dir = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    const path = join(dir, 'manifest.json');
    expect(readManifest(path)).toEqual({ version: 1, entries: [] });
  });

  it('appends new entries and persists them', () => {
    dir = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    const path = join(dir, 'manifest.json');

    appendManifestEntry(entry({ receiptId: 1 }), path);
    appendManifestEntry(entry({ receiptId: 2, cardAmount: 47.23 }), path);

    const manifest = readManifest(path);
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.entries.map((e) => e.receiptId)).toEqual([1, 2]);
  });

  it('upserts by receiptId instead of duplicating on re-submit', () => {
    dir = mkdtempSync(join(tmpdir(), 'manifest-test-'));
    const path = join(dir, 'manifest.json');

    appendManifestEntry(entry({ receiptId: 1, percentages: { Brian: 50, Patrice: 50 } }), path);
    appendManifestEntry(entry({ receiptId: 1, percentages: { Brian: 62, Patrice: 38 } }), path);

    const manifest = readManifest(path);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].percentages).toEqual({ Brian: 62, Patrice: 38 });
  });
});
