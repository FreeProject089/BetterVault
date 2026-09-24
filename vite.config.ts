import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import { iconDataPlugin } from './build/iconDataPlugin.ts';
import { i18nCatalogPlugin } from './build/i18nCatalogPlugin.ts';

export default defineConfig({
  plugins: [iconDataPlugin(import.meta.dirname), i18nCatalogPlugin()],
  // Argon2id, scrypt et chiffrement des sauvegardes sont volontairement lents : délai large quand les tests tournent en parallèle
  test: {
    testTimeout: 30_000,
    // Les copies de travail des autres sessions vivent sous .claude/ : elles ont leurs propres tests
    exclude: [...configDefaults.exclude, '.claude/**'],
    setupFiles: ['tests/setup.ts']
  },
  server: {
    port: 3000,
    open: false,
    // Même origine que l'application, comme en production : le serveur BetterVault local (npm run server)
    // répond sous /api, sert les documents légaux (/legal) et la page d'administration (/admin)
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/legal': 'http://127.0.0.1:8787',
      '/admin': 'http://127.0.0.1:8787'
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
