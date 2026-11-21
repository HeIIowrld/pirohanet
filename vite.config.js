import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  root: 'frontend',
  plugins: [{
    name: 'naver-map-config',
    configureServer(server) {
      const env = loadEnv(mode, import.meta.dirname, ['NAVER_MAP_CLIENT_ID', 'X-NCP-APIGW-API-KEY-ID']);
      const naverClientId = env.NAVER_MAP_CLIENT_ID || env['X-NCP-APIGW-API-KEY-ID'];
      server.middlewares.use('/assets/map-config.json', (_req, res) => {
        res.writeHead(naverClientId ? 200 : 503, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ naverClientId: naverClientId || null }));
      });
    },
  }],
  server: { host: 'localhost', port: 5173, strictPort: true, proxy: {
    '/api': 'http://localhost:5174', '/auth': 'http://localhost:5174',
    '/src/main/index.html': { target: 'http://localhost:5174' },
  } },
  build: { outDir: '../dist', emptyOutDir: true },
}));
