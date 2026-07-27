import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { hasSavedCredentials, saveCredentials } from './googleAuth.js';

describe('hasSavedCredentials', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is false when no token file exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'google-auth-test-'));
    const tokenPath = join(dir, 'google-token.json');
    expect(hasSavedCredentials(tokenPath)).toBe(false);
  });

  it('is true once a token has been saved', () => {
    dir = mkdtempSync(join(tmpdir(), 'google-auth-test-'));
    const tokenPath = join(dir, 'google-token.json');
    saveCredentials({ access_token: 'x', refresh_token: 'y' }, tokenPath);
    expect(hasSavedCredentials(tokenPath)).toBe(true);
  });
});
