import { defineConfig } from 'vite';
export default defineConfig({
  root: 'frontend',
  server: { host: 'localhost', port: 5173, strictPort: true, proxy: {
    '/api': 'http://localhost:5174', '/auth': 'http://localhost:5174',
    '/src/main/index.html': { target: 'http://localhost:5174' },
  } },
  build: { outDir: '../dist', emptyOutDir: true },
});
