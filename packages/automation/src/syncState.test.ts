import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSyncState, saveSyncState } from './syncState.js';

describe('syncState', () => {
  it('returns an empty state when the file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-state-'));
    try {
      const state = loadSyncState(join(dir, 'missing.json'));
      assert.deepEqual(state, {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips state through save and load, creating parent directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-state-'));
    try {
      const path = join(dir, 'nested', 'sync-state.json');
      saveSyncState(path, { Brian: '2026-06-29' });

      const state = loadSyncState(path);
      assert.deepEqual(state, { Brian: '2026-06-29' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
