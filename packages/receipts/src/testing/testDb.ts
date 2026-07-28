import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createPrismaClient, type PrismaClient } from '../db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));

/** Applies every migration to (an already-existing) dbPath — exported so other packages' test/e2e setup can migrate a DB at a path of their own choosing, not just createTestDb's own temp dir. */
export function migrateDbAt(dbPath: string): void {
    const db = new Database(dbPath);
    const migrationDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    for (const dir of migrationDirs) {
        db.exec(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf-8'));
    }
    db.close();
}

/** A fresh, fully-migrated temp SQLite DB for tests — real Prisma client, no mocking of the datastore. */
export function createTestDb(): { prisma: PrismaClient; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'receipts-test-'));
    const dbPath = join(dir, 'test.db');
    migrateDbAt(dbPath);

    const prisma = createPrismaClient(`file:${dbPath}`);
    return {
        prisma,
        cleanup: () => {
            rmSync(dir, { recursive: true, force: true });
        },
    };
}
