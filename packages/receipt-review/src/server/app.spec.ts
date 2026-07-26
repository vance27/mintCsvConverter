import { describe, it, expect } from 'vitest';
import { app } from './app.js';

describe('app', () => {
  it('responds to a health check', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
