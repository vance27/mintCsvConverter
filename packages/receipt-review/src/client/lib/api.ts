import { hc } from 'hono/client';
import type { AppType } from '../../server/app.js';

// Relative base URL: works both via Vite's dev proxy (see vite.config.ts) and
// unchanged in production, where the Hono server serves this same origin.
// Routes are registered under /api on the server, so hc's generated client
// property chain would otherwise start with a redundant `.api` — trim it
// once here so call sites read `api.receipts.$get()`, not `api.api.receipts`.
export const api = hc<AppType>('/').api;
