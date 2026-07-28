import { writeFileSync } from 'node:fs';
import { stringify } from 'csv-stringify/sync';

export class ExportFileToLines {
    constructor(private readonly lines: string[][]) {}

    writeFile(name: string, valid: string = 'VALID'): string {
        const timestamp = formatTimestamp(new Date());
        const filename = `${name}_${timestamp}_${valid}_csvConverter.csv`;
        const content = stringify(this.lines);
        writeFileSync(filename, content, 'utf-8');
        return filename;
    }
}

function formatTimestamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}
