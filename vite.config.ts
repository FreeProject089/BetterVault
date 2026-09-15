import { defineConfig } from 'vite';
import { iconDataPlugin } from './build/iconDataPlugin.ts';

export default defineConfig({
  plugins: [iconDataPlugin(import.meta.dirname)],
  // Argon2id, scrypt et chiffrement des sauvegardes sont volontairement lents : délai large quand les tests tournent en parallèle
  test: {
    testTimeout: 30_000
  },
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
          // Les bibliothèques d'icônes restent dans leurs propres fichiers, chargés à l'ouverture du sélecteur
          if (id.includes('node_modules') && !id.includes('node_modules/lucide')) {
            return 'vendor';
          }
        }
      }
    }
  }
});
