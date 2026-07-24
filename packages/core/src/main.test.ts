import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { main, parseCliArgs, type MainDeps } from './main.js';
import { ExportFileToLines } from './exportFileToLines.js';

describe('parseCliArgs', () => {
  it('defaults name to Brian when omitted', () => {
    const args = parseCliArgs(['input.csv', 'EXPENSE_SPLITTING']);
    assert.equal(args.inputFile, 'input.csv');
    assert.equal(args.outputFormat, 'EXPENSE_SPLITTING');
    assert.equal(args.name, 'Brian');
    assert.equal(args.help, false);
  });

  it('uses an explicit name when provided', () => {
    const args = parseCliArgs(['input.csv', 'EXPENSE_SPLITTING', 'Patrice']);
    assert.equal(args.name, 'Patrice');
  });
});

describe('main', () => {
  it('defaults the payer to Brian when the arg is omitted', () => {
    const convertFile = mock.fn(() => [[], []] as [string[][], string[][]]);
    const writeFile = mock.fn(() => 'stub.csv');
    const FakeExporter = function (this: unknown, _lines: string[][]) {
      return { writeFile };
    } as unknown as typeof ExportFileToLines;
    const deps: MainDeps = { convertFile, ExportFileToLines: FakeExporter };

    main(['input.csv', 'EXPENSE_SPLITTING'], deps);

    assert.equal(convertFile.mock.calls.length, 1);
    assert.deepEqual(convertFile.mock.calls[0]?.arguments, ['input.csv', 'EXPENSE_SPLITTING', 'Brian']);
  });

  it('uses the explicit payer name when provided', () => {
    const convertFile = mock.fn(() => [[], []] as [string[][], string[][]]);
    const writeFile = mock.fn(() => 'stub.csv');
    const FakeExporter = function (this: unknown, _lines: string[][]) {
      return { writeFile };
    } as unknown as typeof ExportFileToLines;
    const deps: MainDeps = { convertFile, ExportFileToLines: FakeExporter };

    main(['input.csv', 'EXPENSE_SPLITTING', 'Patrice'], deps);

    assert.deepEqual(convertFile.mock.calls[0]?.arguments, ['input.csv', 'EXPENSE_SPLITTING', 'Patrice']);
  });
});
