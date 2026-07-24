import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSyncState, saveSyncState } from './syncState.js';

describe('syncState', () => {
  it('returns an empty state when the file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-state-'));
    try {
      const state = loadSyncState(join(dir, 'missing.json'));
      expect(state).toEqual({});
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
      expect(state).toEqual({ Brian: '2026-06-29' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
