import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.RECEIPT_REVIEW_API_PORT ?? 3100);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`receipt-review API listening on http://localhost:${info.port}`);
});
