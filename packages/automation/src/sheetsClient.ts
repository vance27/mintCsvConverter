export interface SheetsClientConfig {
  webAppUrl: string;
  token: string;
}

export interface AddTransactionsRequest {
  payerName: string;
  periodLabel: string;
  /** Each row is [description, payerName, amount, splitType] — columns A-D only. */
  rows: string[][];
}

export interface AddTransactionsResult {
  sheetName: string;
  rowsAdded: number;
}

interface AddTransactionsResponseBody {
  ok: boolean;
  result?: AddTransactionsResult;
  error?: string;
}

/** Thin client for the Apps Script Web App endpoint in packages/apps-script. */
export class SheetsClient {
  constructor(private readonly config: SheetsClientConfig) {}

  async addTransactionsForPeriod(request: AddTransactionsRequest): Promise<AddTransactionsResult> {
    const response = await fetch(this.config.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: this.config.token,
        payerName: request.payerName,
        periodLabel: request.periodLabel,
        rows: request.rows,
      }),
    });

    if (!response.ok) {
      throw new Error(`Sheets endpoint returned HTTP ${response.status}`);
    }

    // Apps Script Web Apps always respond HTTP 200 regardless of internal
    // outcome, so the real success/failure signal is the `ok` field here.
    const body = (await response.json()) as AddTransactionsResponseBody;
    if (!body.ok) {
      throw new Error(`Sheets endpoint rejected the request: ${body.error ?? 'unknown error'}`);
    }
    if (!body.result) {
      throw new Error('Sheets endpoint returned ok:true without a result');
    }
    return body.result;
  }
}

export function loadSheetsClientConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SheetsClientConfig {
  const webAppUrl = env.SHEETS_WEBAPP_URL;
  const token = env.SHEETS_SYNC_TOKEN;
  if (!webAppUrl) {
    throw new Error('Missing SHEETS_WEBAPP_URL environment variable');
  }
  if (!token) {
    throw new Error('Missing SHEETS_SYNC_TOKEN environment variable');
  }
  return { webAppUrl, token };
}
