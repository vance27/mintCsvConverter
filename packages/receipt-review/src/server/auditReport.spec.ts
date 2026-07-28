import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { generateAuditHtml, writeAuditHtml, type AuditReportData } from './auditReport.js';

describe('auditReport', () => {
    let dir: string | undefined;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true, force: true });
        }
        dir = undefined;
    });

    const data: AuditReportData = {
        receiptId: 12,
        store: 'Costco',
        payer: 'Brian',
        purchaseDate: '2026-07-14',
        total: 20,
        lineItems: [
            { name: 'Widget & Co', unitPrice: 10, quantity: 2, lineTotal: 20, splits: { Brian: 60, Patrice: 40 } },
        ],
        aggregate: { Brian: 60, Patrice: 40 },
    };

    it('renders each participant share and escapes untrusted text', () => {
        const html = generateAuditHtml(data);

        expect(html).toContain('Widget &amp; Co');
        expect(html).toContain('$12.00'); // Brian's 60% share of the $20 line
        expect(html).toContain('$8.00'); // Patrice's 40% share
        expect(html).toContain('Brian: 60%, Patrice: 40%');
    });

    it('writes to <baseDir>/<receiptId>.html', () => {
        dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
        const path = writeAuditHtml(data.receiptId, generateAuditHtml(data), dir);

        expect(path).toBe(join(dir, '12.html'));
        expect(existsSync(path)).toBe(true);
        expect(readFileSync(path, 'utf-8')).toContain('Costco');
    });
});
