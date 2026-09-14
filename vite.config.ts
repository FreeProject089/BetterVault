import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: false,
    // Même origine que l'application : le serveur BetterVault local (npm run server) répond sous /api
    proxy: {
      '/api': 'http://127.0.0.1:8787'
    }
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      }
    }
  }
});
