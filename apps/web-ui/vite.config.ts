import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // In development the browser talks to Vite, which forwards to api directly.
      // In production this hop is the proxy service instead.
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true, ws: true },
    },
  },
});
