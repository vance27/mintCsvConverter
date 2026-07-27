import { test, expect } from '@playwright/test';

// Two different months so the sync overview groups them into two separate
// tabs — exercises the (payer, period) grouping, not just a flat count.
// Costco (Variably) has no seeded receipt in the fresh e2e DB, so it should
// show up unmatched in Review transactions.
const CSV_CONTENT = [
  'Status,Date,Description,Debit,Credit,Member Name',
  'Cleared,06/20/2026,Chipotle Mexican Grill,25.00,,BRIAN K VANCE',
  'Cleared,07/02/2026,Costco Wholesale,150.00,,BRIAN K VANCE',
  'Cleared,06/22/2026,CITI CARD PAYMENT,500.00,,BRIAN K VANCE',
].join('\n');

// Deliberately never clicks "Run sync" or "Reauthorize" — those touch real
// Google Sheets/OAuth and stay covered by app.spec.ts's fake-injected
// integration tests instead. This suite proves the real browser + real HTTP
// + real (isolated) DB stack renders and wires together correctly.
test.describe.configure({ mode: 'serial' });

test.describe('receipt-review pipeline', () => {
  test('top nav renders and every tab navigates with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Receipts' })).toBeVisible();

    await page.getByRole('tab', { name: 'Import' }).click();
    await expect(page.getByRole('heading', { name: 'Import transactions' })).toBeVisible();

    await page.getByRole('tab', { name: 'Review transactions' }).click();
    await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible();
    await expect(page.getByText('No transactions staged yet')).toBeVisible();

    await page.getByRole('tab', { name: 'Sync' }).click();
    await expect(page.getByRole('heading', { name: 'Sync overview' })).toBeVisible();
    await expect(page.getByText('Nothing to sync')).toBeVisible();
    await expect(page.getByText('No syncs run yet.')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('imports a CSV export and stages transactions without syncing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Import' }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'export.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV_CONTENT),
    });

    // importedCount counts every newly-persisted row, excluded ones included
    // (they're still staged, just flagged, for auditability) — 3 total rows,
    // 1 of them excluded, matching app.spec.ts's server-level equivalent.
    await expect(page.getByText('3 staged, 0 already staged, 1 excluded')).toBeVisible({ timeout: 15_000 });
  });

  test('review transactions shows the staged rows and their receipt-match status', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Review transactions' }).click();

    await expect(page.getByRole('cell', { name: 'Chipotle Mexican Grill' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Costco Wholesale' })).toBeVisible();
    await expect(page.getByText('No receipt yet')).toBeVisible();
  });

  test('sync overview reflects the newly-staged, still-unsynced transactions', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Sync' }).click();

    await expect(page.getByText(/2 row\(s\) across 2 tab\(s\) will sync/)).toBeVisible();
    await expect(page.getByRole('cell', { name: '06/26' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '07/26' })).toBeVisible();
  });

  // Last in the serial sequence — it removes/re-adds and edits a staged
  // row, which would otherwise perturb the row/tab counts the previous
  // test asserts.
  test('editing split type and removing/undoing a transaction works from Review transactions', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Review transactions' }).click();

    const chipotleRow = page.getByRole('row', { name: /Chipotle Mexican Grill/ });
    await chipotleRow.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Variably' }).click();
    await expect(chipotleRow.getByRole('combobox')).toHaveText('Variably');
    await chipotleRow.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Equally' }).click();
    await expect(chipotleRow.getByRole('combobox')).toHaveText('Equally');

    const costcoRow = page.getByRole('row', { name: /Costco Wholesale/ });
    await costcoRow.getByRole('button', { name: 'Remove transaction' }).click();
    await expect(page.getByRole('cell', { name: 'Costco Wholesale' })).toHaveCount(0);

    await page.getByRole('switch', { name: 'Show excluded/removed' }).click();
    await expect(page.getByRole('cell', { name: 'Costco Wholesale' })).toBeVisible();
    await expect(page.getByText('Removed', { exact: true })).toBeVisible();

    await page.getByRole('row', { name: /Costco Wholesale/ }).getByRole('button', { name: 'Undo removal' }).click();
    await expect(page.getByText('Removed', { exact: true })).toHaveCount(0);
  });

  // A CSV shape with no saved CsvImportProfile — never seen before — so the
  // configurator should appear instead of importing straight away.
  const NEW_SHAPE_CSV = ['Date,Description,Amount', '08/01/2026,Target Run,45.00'].join('\n');

  test('a never-before-seen CSV shape goes through the configurator, then imports', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Import' }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'other-bank-export.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(NEW_SHAPE_CSV),
    });

    await expect(page.getByRole('heading', { name: 'Configure a new CSV format' })).toBeVisible();
    // Column defaults already line up for this 3-column Date/Description/Amount
    // shape, so only the profile name needs filling in.
    await page.getByLabel('Profile name').fill('Other Bank');
    await page.getByRole('button', { name: 'Save & Import' }).click();

    await expect(page.getByText('1 staged, 0 already staged, 0 excluded')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Review transactions' }).click();
    await expect(page.getByRole('cell', { name: 'Target Run' })).toBeVisible();
  });
});
