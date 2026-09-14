import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { iconDataPlugin } from './build/iconDataPlugin.ts';

/**
 * Extension navigateur (Chrome, Edge, Firefox — Manifest V3) :
 * application complète (index.html) + popup, depuis le même code que le site.
 */

const root = import.meta.dirname;
const outDir = resolve(root, 'dist-extension');

function extensionFiles(): Plugin {
  return {
    name: 'bettervault-extension-files',
    closeBundle() {
      mkdirSync(resolve(outDir, 'icons'), { recursive: true });
      copyFileSync(resolve(root, 'extension/manifest.json'), resolve(outDir, 'manifest.json'));
      copyFileSync(resolve(root, 'src-tauri/icons/32x32.png'), resolve(outDir, 'icons/32.png'));
      copyFileSync(resolve(root, 'src-tauri/icons/128x128.png'), resolve(outDir, 'icons/128.png'));
      cpSync(resolve(root, 'public/brand'), resolve(outDir, 'brand'), { recursive: true });
    }
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        app: resolve(root, 'index.html'),
        popup: resolve(root, 'extension/popup.html')
      }
    }
  },
  plugins: [iconDataPlugin(root), extensionFiles()]
});
