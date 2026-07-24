import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Maps payer name -> newest transaction date (YYYY-MM-DD) synced so far for that payer. */
export type SyncState = Record<string, string>;

export function loadSyncState(path: string): SyncState {
  if (!existsSync(path)) {
    return {};
  }
  const content = readFileSync(path, 'utf-8').trim();
  if (content === '') {
    return {};
  }
  return JSON.parse(content) as SyncState;
}

export function saveSyncState(path: string, state: SyncState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

export function defaultSyncStatePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  return `${home}/.config/mint-csv-converter/sync-state.json`;
}
