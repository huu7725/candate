import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: { outDir: mode === 'cloudflare' ? 'dist-cloudflare' : 'dist' },
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
}));
