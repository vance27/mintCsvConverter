import { describe, it, expect, vi } from 'vitest';
import { main, parseCliArgs, type MainDeps } from './main.js';
import { ExportFileToLines } from './exportFileToLines.js';

describe('parseCliArgs', () => {
  it('defaults name to Brian when omitted', () => {
    const args = parseCliArgs(['input.csv', 'EXPENSE_SPLITTING']);
    expect(args.inputFile).toBe('input.csv');
    expect(args.outputFormat).toBe('EXPENSE_SPLITTING');
    expect(args.name).toBe('Brian');
    expect(args.help).toBe(false);
  });

  it('uses an explicit name when provided', () => {
    const args = parseCliArgs(['input.csv', 'EXPENSE_SPLITTING', 'Patrice']);
    expect(args.name).toBe('Patrice');
  });
});

describe('main', () => {
  it('defaults the payer to Brian when the arg is omitted', () => {
    const convertFile = vi.fn(() => [[], []] as [string[][], string[][]]);
    const writeFile = vi.fn(() => 'stub.csv');
    const FakeExporter = function (this: unknown, _lines: string[][]) {
      return { writeFile };
    } as unknown as typeof ExportFileToLines;
    const deps: MainDeps = { convertFile, ExportFileToLines: FakeExporter };

    main(['input.csv', 'EXPENSE_SPLITTING'], deps);

    expect(convertFile.mock.calls.length).toBe(1);
    expect(convertFile.mock.calls[0]).toEqual(['input.csv', 'EXPENSE_SPLITTING', 'Brian']);
  });

  it('uses the explicit payer name when provided', () => {
    const convertFile = vi.fn(() => [[], []] as [string[][], string[][]]);
    const writeFile = vi.fn(() => 'stub.csv');
    const FakeExporter = function (this: unknown, _lines: string[][]) {
      return { writeFile };
    } as unknown as typeof ExportFileToLines;
    const deps: MainDeps = { convertFile, ExportFileToLines: FakeExporter };

    main(['input.csv', 'EXPENSE_SPLITTING', 'Patrice'], deps);

    expect(convertFile.mock.calls[0]).toEqual(['input.csv', 'EXPENSE_SPLITTING', 'Patrice']);
  });
});
