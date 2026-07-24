import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { ImportFileToLines } from './importFileToLines.js';
import { ExportFileToLines } from './exportFileToLines.js';

describe('ImportFileToLines', () => {
  it('normalizes the real Citi export layout (Status, Date, Description, Debit, Credit, Member Name)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mint-csv-import-'));
    try {
      const path = join(dir, 'export.csv');
      writeCsv(path, [
        ['Status', 'Date', 'Description', 'Debit', 'Credit', 'Member Name'],
        ['Cleared', '06/29/2026', 'ONLINE PAYMENT, THANK YOU', '', '-3505.42', 'BRIAN K VANCE'],
        ['Cleared', '06/27/2026', "SQ *BRAVI'S CRAFT MEXICAN Shakopee MN", '56.60', '', 'BRIAN K VANCE'],
        ['Cleared', '06/13/2026', 'REI #109 MAPLE GROVE MAPLE GROVE MN', '', '-56.77', 'BRIAN K VANCE'],
      ]);

      const results = new ImportFileToLines(path).getResults();

      assert.equal(results.length, 4);
      // Row 1: amount came from Credit (a card payment) — sign is preserved, not forced positive.
      assert.deepEqual(results[1], ['06/29/2026', 'ONLINE PAYMENT, THANK YOU', '', '-3505.42']);
      // Row 2: amount came from Debit (a purchase).
      assert.deepEqual(results[2], ['06/27/2026', "SQ *BRAVI'S CRAFT MEXICAN Shakopee MN", '', '56.60']);
      // Row 3: a genuine merchant refund via Credit — must stay negative, not get abs()'d
      // into looking like an ordinary positive charge.
      assert.deepEqual(results[3], ['06/13/2026', 'REI #109 MAPLE GROVE MAPLE GROVE MN', '', '-56.77']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when the header is missing an expected column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mint-csv-import-'));
    try {
      const path = join(dir, 'bad.csv');
      writeCsv(path, [
        ['Date', 'Description', 'Amount'],
        ['06/20/2024', 'Chipotle', '25.00'],
      ]);

      assert.throws(() => new ImportFileToLines(path).getResults(), /Debit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('separate instances do not share results', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mint-csv-import-'));
    try {
      const pathA = join(dir, 'a.csv');
      const pathB = join(dir, 'b.csv');
      writeCsv(pathA, [
        ['Status', 'Date', 'Description', 'Debit', 'Credit', 'Member Name'],
        ['Cleared', '06/20/2024', 'Chipotle', '25.00', '', 'BRIAN K VANCE'],
      ]);
      writeCsv(pathB, [
        ['Status', 'Date', 'Description', 'Debit', 'Credit', 'Member Name'],
        ['Cleared', '06/21/2024', 'Costco', '150.00', '', 'BRIAN K VANCE'],
      ]);

      const importerA = new ImportFileToLines(pathA);
      const importerB = new ImportFileToLines(pathB);

      const resultsA = importerA.getResults();
      const resultsB = importerB.getResults();

      assert.notEqual(resultsA, resultsB);
      assert.equal(resultsA.length, 2);
      assert.equal(resultsB.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ExportFileToLines', () => {
  it('produces a safe filename and roundtrips contents', () => {
    const lines = [['Chipotle 06/20/2024', 'Brian', '25.00', 'Equally', 'TRUE', 'TRUE']];
    const dir = mkdtempSync(join(tmpdir(), 'mint-csv-export-'));
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      new ExportFileToLines(lines).writeFile('Brian');
    } finally {
      process.chdir(cwd);
    }

    try {
      const writtenFiles = readdirSync(dir);
      assert.equal(writtenFiles.length, 1);
      const filename = writtenFiles[0]!;
      assert.equal(filename.includes(' '), false);
      assert.equal(filename.includes(':'), false);

      const content = readFileSync(join(dir, filename), 'utf-8');
      assert.deepEqual(parse(content), lines);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writeCsv(path: string, rows: string[][]): void {
  writeFileSync(path, stringify(rows), 'utf-8');
}
