import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AuditLineItem {
    name: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    splits: Record<string, number>;
}

export interface AuditReportData {
    receiptId: number;
    store: string;
    payer: string;
    purchaseDate: string;
    total: number;
    lineItems: AuditLineItem[];
    aggregate: Record<string, number>;
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A permanent, human-readable record of what was submitted — the "generated audit copy" from the design doc. Plain template, no templating dependency needed. */
export function generateAuditHtml(data: AuditReportData): string {
    const participants = Object.keys(data.aggregate);

    const rows = data.lineItems
        .map((line) => {
            const shareCells = participants
                .map((name) => `<td>$${((line.lineTotal * (line.splits[name] ?? 0)) / 100).toFixed(2)}</td>`)
                .join('');
            return `<tr><td>${escapeHtml(line.name)}</td><td>$${line.unitPrice.toFixed(2)}</td><td>${line.quantity}</td><td>$${line.lineTotal.toFixed(2)}</td>${shareCells}</tr>`;
        })
        .join('\n');

    const shareHeaders = participants.map((name) => `<th>${escapeHtml(name)}'s share</th>`).join('');
    const aggregateSummary = participants.map((name) => `${escapeHtml(name)}: ${data.aggregate[name]}%`).join(', ');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt #${data.receiptId} — ${escapeHtml(data.store)} ${escapeHtml(data.purchaseDate)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: right; }
    th:first-child, td:first-child { text-align: left; }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.store)} — ${escapeHtml(data.purchaseDate)}</h1>
  <p>Paid by ${escapeHtml(data.payer)}. Total: $${data.total.toFixed(2)}.</p>
  <table>
    <thead>
      <tr><th>Item</th><th>Unit price</th><th>Qty</th><th>Line total</th>${shareHeaders}</tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p><strong>Aggregate split:</strong> ${aggregateSummary}</p>
</body>
</html>
`;
}

export function defaultAuditDir(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    return `${home}/.config/mint-csv-converter/receipt-audits`;
}

export function writeAuditHtml(receiptId: number, html: string, baseDir: string = defaultAuditDir()): string {
    mkdirSync(baseDir, { recursive: true });
    const path = join(baseDir, `${receiptId}.html`);
    writeFileSync(path, html, 'utf-8');
    return path;
}
