import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/prisma/client.js';

export type { PrismaClient } from './generated/prisma/client.js';

/**
 * Default datastore location — `~/.config/mint-csv-converter/receipts.db`,
 * mirroring the automation package's `~/.config/mint-csv-converter/`
 * convention. Overridden by `DATABASE_URL`.
 */
export function defaultDatabaseUrl(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    return `file:${home}/.config/mint-csv-converter/receipts.db`;
}

/**
 * Builds a PrismaClient backed by the better-sqlite3 driver adapter
 * (Prisma 7's driver-adapter model — no query-engine binary at runtime).
 * Ensures the parent directory of a file-backed database exists, since
 * better-sqlite3 opens but does not create it.
 */
export function createPrismaClient(url: string = process.env.DATABASE_URL ?? defaultDatabaseUrl()): PrismaClient {
    if (url !== ':memory:') {
        mkdirSync(dirname(url.replace(/^file:/, '')), { recursive: true });
    }
    const adapter = new PrismaBetterSqlite3({ url });
    return new PrismaClient({ adapter });
}

let singleton: PrismaClient | undefined;

/** Process-wide singleton client for the default (env/default) datastore. */
export function getPrisma(): PrismaClient {
    singleton ??= createPrismaClient();
    return singleton;
}
