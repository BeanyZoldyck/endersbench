/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api/benchmarks': { target: process.env.BENCHMARK_PROXY_TARGET ?? 'http://127.0.0.1:8790', changeOrigin: true }, '/api/finance-control': { target: 'http://127.0.0.1:3013' } } },
  build: { rollupOptions: { input: {
    clearing: fileURLToPath(new URL('./index.html', import.meta.url)),
    finance: fileURLToPath(new URL('./finance.html', import.meta.url)),
  } } },
  // Env overrides (VITE_SPACETIMEDB_HOST, VITE_SPACETIMEDB_DB_NAME) live in config/.
  // Defaults in src/main.tsx point at the local `endersbench` database.
  envDir: 'config',
  // The module (spacetimedb/) has its own tests and config: npm run test:module.
  test: { include: ['src/**/*.test.ts', 'harness/**/*.test.ts', 'actors/**/*.test.ts'] },
});
