import { describe, it, expect, afterEach, vi } from 'vitest';
import { SheetsClient, loadSheetsClientConfigFromEnv } from './sheetsClient.js';

describe('SheetsClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the expected payload and returns the result on success', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, result: { sheetName: 'Brian 07/26', rowsAdded: 2 } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new SheetsClient({ webAppUrl: 'https://example.com/exec', token: 'secret' });
    const result = await client.addTransactionsForPeriod({
      payerName: 'Brian',
      periodLabel: '07/26',
      rows: [['Chipotle 07/01/2026', 'Brian', '28.18', 'Equally']],
    });

    expect(result).toEqual({ sheetName: 'Brian 07/26', rowsAdded: 2 });
    expect(fetchMock.mock.calls.length).toBe(1);

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://example.com/exec');
    const init = call[1] as RequestInit;
    const body = JSON.parse(init.body as string) as unknown;
    expect(body).toEqual({
      token: 'secret',
      payerName: 'Brian',
      periodLabel: '07/26',
      rows: [['Chipotle 07/01/2026', 'Brian', '28.18', 'Equally']],
    });
  });

  it('throws when the endpoint reports ok:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 200 })),
    );

    const client = new SheetsClient({ webAppUrl: 'https://example.com/exec', token: 'wrong' });
    await expect(
      client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [] }),
    ).rejects.toThrow(/Unauthorized/);
  });

  it('throws on a non-2xx HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );

    const client = new SheetsClient({ webAppUrl: 'https://example.com/exec', token: 'secret' });
    await expect(
      client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [] }),
    ).rejects.toThrow(/500/);
  });
});

describe('loadSheetsClientConfigFromEnv', () => {
  it('reads the url and token from env', () => {
    const config = loadSheetsClientConfigFromEnv({
      SHEETS_WEBAPP_URL: 'https://example.com/exec',
      SHEETS_SYNC_TOKEN: 'secret',
    });
    expect(config).toEqual({ webAppUrl: 'https://example.com/exec', token: 'secret' });
  });

  it('throws when SHEETS_WEBAPP_URL is missing', () => {
    expect(() => loadSheetsClientConfigFromEnv({ SHEETS_SYNC_TOKEN: 'secret' })).toThrow(
      /SHEETS_WEBAPP_URL/,
    );
  });

  it('throws when SHEETS_SYNC_TOKEN is missing', () => {
    expect(() =>
      loadSheetsClientConfigFromEnv({ SHEETS_WEBAPP_URL: 'https://example.com/exec' }),
    ).toThrow(/SHEETS_SYNC_TOKEN/);
  });
});
