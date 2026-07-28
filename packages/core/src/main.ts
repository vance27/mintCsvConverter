import { parseArgs } from 'node:util';
import { CsvConverterFactory, type ConvertResult } from './csvConverterFactory.js';
import { ImportFileToLines } from './importFileToLines.js';
import { ExportFileToLines } from './exportFileToLines.js';

export const USAGE = `Usage: main.ts <input_file.csv> <output_format> [name]

Convert a Mint.com transaction export CSV into an expense-splitting CSV.

  input_file.csv  Path to the Mint.com transaction export CSV
  output_format   Output format (currently only EXPENSE_SPLITTING is supported)
  name            Name of the person who paid (default: Brian)`;

export function convertFile(inputFile: string, outputFormat: string, name = 'Brian'): ConvertResult {
    console.log('Converting file: ', inputFile, ' in ', outputFormat, ' format, for ', name);
    const importer = new ImportFileToLines(inputFile);
    const lines = importer.getResults();
    const converter = new CsvConverterFactory();
    return converter.convert(lines, outputFormat, name);
}

export interface ParsedArgs {
    help: boolean;
    inputFile?: string;
    outputFormat?: string;
    name: string;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { help: { type: 'boolean', short: 'h' } },
    });

    const [inputFile, outputFormat, name] = positionals;
    return {
        help: values.help === true,
        inputFile,
        outputFormat,
        name: name ?? 'Brian',
    };
}

export interface MainDeps {
    convertFile: typeof convertFile;
    ExportFileToLines: typeof ExportFileToLines;
}

const defaultDeps: MainDeps = { convertFile, ExportFileToLines };

export function main(argv: string[] = process.argv.slice(2), deps: MainDeps = defaultDeps): void {
    const args = parseCliArgs(argv);

    if (args.help) {
        console.log(USAGE);
        return;
    }
    if (!args.inputFile || !args.outputFormat) {
        console.error(USAGE);
        process.exitCode = 1;
        return;
    }

    console.log('Starting conversion process', args.inputFile, args.outputFormat);
    const [lines, invalidLines] = deps.convertFile(args.inputFile, args.outputFormat, args.name);
    const exporter = new deps.ExportFileToLines(lines);
    const invalidExporter = new deps.ExportFileToLines(invalidLines);
    exporter.writeFile(args.name);
    invalidExporter.writeFile(args.name, 'INVALID');
    console.log('Done with conversion process');
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
    main();
}
