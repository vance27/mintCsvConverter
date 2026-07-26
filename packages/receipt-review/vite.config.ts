import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Hono API server (src/server) is never bundled by Vite — it's run
// directly via tsx, same as this repo's other CLI/server scripts. In dev,
// Vite only serves the React client and proxies /api to that separate
// process; in production, the Hono server itself serves this build's
// dist/client output alongside the API from one process/port.
const API_PORT = process.env.RECEIPT_REVIEW_API_PORT ?? '3100';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
  },
});
