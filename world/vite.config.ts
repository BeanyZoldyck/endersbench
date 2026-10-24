import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Env overrides (VITE_SPACETIMEDB_HOST, VITE_SPACETIMEDB_DB_NAME) live in config/.
  // Defaults in src/main.tsx point at the local `endersbench` database.
  envDir: 'config',
});
