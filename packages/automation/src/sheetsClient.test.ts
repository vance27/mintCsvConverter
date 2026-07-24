import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SheetsClient, loadSheetsClientConfigFromEnv } from './sheetsClient.js';

describe('SheetsClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts the expected payload and returns the result on success', async () => {
    const fetchMock = mock.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, result: { sheetName: 'Brian 07/26', rowsAdded: 2 } }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SheetsClient({ webAppUrl: 'https://example.com/exec', token: 'secret' });
    const result = await client.addTransactionsForPeriod({
      payerName: 'Brian',
      periodLabel: '07/26',
      rows: [['Chipotle 07/01/2026', 'Brian', '28.18', 'Equally']],
    });

    assert.deepEqual(result, { sheetName: 'Brian 07/26', rowsAdded: 2 });
    assert.equal(fetchMock.mock.calls.length, 1);

    const call = fetchMock.mock.calls[0]!;
    assert.equal(call.arguments[0], 'https://example.com/exec');
    const init = call.arguments[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    assert.deepEqual(body, {
      token: 'secret',
      payerName: 'Brian',
      periodLabel: '07/26',
      rows: [['Chipotle 07/01/2026', 'Brian', '28.18', 'Equally']],
    });
  });

  it('throws when the endpoint reports ok:false', async () => {
    globalThis.fetch = mock.fn(
      async () => new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 200 }),
    ) as unknown as typeof fetch;

    const client = new SheetsClient({ webAppUrl: 'https://example.com/exec', token: 'wrong' });
    await assert.rejects(
      () => client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [] }),
      /Unauthorized/,
    );
  });

  it('throws on a non-2xx HTTP response', async () => {
    globalThis.fetch = mock.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;

    const client = new SheetsClient({ webAppUrl: 'https://example.com/exec', token: 'secret' });
    await assert.rejects(
      () => client.addTransactionsForPeriod({ payerName: 'Brian', periodLabel: '07/26', rows: [] }),
      /500/,
    );
  });
});

describe('loadSheetsClientConfigFromEnv', () => {
  it('reads the url and token from env', () => {
    const config = loadSheetsClientConfigFromEnv({
      SHEETS_WEBAPP_URL: 'https://example.com/exec',
      SHEETS_SYNC_TOKEN: 'secret',
    } as NodeJS.ProcessEnv);
    assert.deepEqual(config, { webAppUrl: 'https://example.com/exec', token: 'secret' });
  });

  it('throws when SHEETS_WEBAPP_URL is missing', () => {
    assert.throws(
      () => loadSheetsClientConfigFromEnv({ SHEETS_SYNC_TOKEN: 'secret' } as NodeJS.ProcessEnv),
      /SHEETS_WEBAPP_URL/,
    );
  });

  it('throws when SHEETS_SYNC_TOKEN is missing', () => {
    assert.throws(
      () => loadSheetsClientConfigFromEnv({ SHEETS_WEBAPP_URL: 'https://example.com/exec' } as NodeJS.ProcessEnv),
      /SHEETS_SYNC_TOKEN/,
    );
  });
});
