import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createOllamaClient, getPrisma } from '@mint-csv-converter/receipts';
import { createApp } from './app.js';

const port = Number(process.env.RECEIPT_REVIEW_API_PORT ?? 3100);

// vite build only ever produces the client bundle (see vite.config.ts) — the
// server side is always run directly via tsx, never bundled. In production
// this same process serves both the API and that built client bundle from
// one port; dev serves the client via Vite's own server instead (proxying
// /api back to this process — see vite.config.ts).
const clientDir = 'packages/receipt-review/dist/client';

const app = createApp({ prisma: getPrisma(), client: createOllamaClient() }).use('/*', serveStatic({ root: clientDir }));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`receipt-review listening on http://localhost:${info.port}`);
});
