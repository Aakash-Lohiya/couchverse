import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // API_PORT can be set in client/.env.local (or the environment) when 4000 is taken.
  const env = loadEnv(mode, here, '');
  const api = `http://localhost:${env.API_PORT || process.env.API_PORT || 4000}`;
  return {
    plugins: [react()],
    resolve: {
      alias: { '@shared': path.resolve(here, '..', 'shared') },
    },
    server: {
      port: 5173,
      host: true,
      fs: { allow: [path.resolve(here, '..')] },
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/media': { target: api, changeOrigin: true },
        '/socket.io': { target: api, ws: true, changeOrigin: true },
      },
    },
  };
});
