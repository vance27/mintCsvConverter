import { defineConfig } from 'prisma/config';

// Default the datastore to ~/.config/mint-csv-converter/receipts.db (same
// convention as the automation package's syncState/token paths). Override
// with DATABASE_URL. Used by the Prisma CLI (migrate/studio); the runtime
// client builds its own better-sqlite3 adapter in src/db.ts.
const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
const defaultUrl = `file:${home}/.config/mint-csv-converter/receipts.db`;

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: process.env.DATABASE_URL ?? defaultUrl,
    },
});
