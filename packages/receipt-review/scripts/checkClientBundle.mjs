#!/usr/bin/env node
// Guards against server-only dependencies (Prisma, better-sqlite3, ollama,
// pdf-to-img) leaking into the browser bundle. The client imports aggregateSplits
// via the @mint-csv-converter/receipts/aggregate subpath export rather than the
// package's main barrel — barrel-importing pulled in the full Prisma/better-sqlite3
// runtime even though aggregate.ts itself has no such imports, so the subpath
// is load-bearing, not cosmetic. This check catches a regression if the subpath
// mapping is ever removed or aggregate.ts grows a server-only import.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = ['PrismaClient', 'better-sqlite3', '@prisma/adapter-better-sqlite3', 'ollama', 'pdf-to-img'];
const ASSETS_DIR = join(import.meta.dirname, '..', 'dist', 'client', 'assets');

const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'));
const violations = [];

for (const file of files) {
    const contents = readFileSync(join(ASSETS_DIR, file), 'utf8');
    for (const needle of FORBIDDEN) {
        if (contents.includes(needle)) {
            violations.push(`${file}: contains "${needle}"`);
        }
    }
}

if (violations.length > 0) {
    console.error('Client bundle contains server-only dependencies:');
    for (const v of violations) {
        console.error(`  ${v}`);
    }
    process.exit(1);
}

console.log(`Checked ${files.length} client bundle file(s) — no server-only dependencies found.`);
