import type { Plugin } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Données d'icônes compactes pour le sélecteur (chargées seulement à l'ouverture du sélecteur) :
 * - virtual:bettervault-icons/simple   → [slug, titre, couleur, tracé][] depuis simple-icons
 * - virtual:bettervault-icons/phosphor → [nom, mots-clés, contenu SVG][] depuis @phosphor-icons/core (style regular)
 * Lucide est importé directement (module déjà compact).
 */

const PREFIX = 'virtual:bettervault-icons/';

/** Logos affichés directement dans l'application (import / export), sans charger toute la bibliothèque */
const BRAND_SLUGS = ['bitwarden', '1password', 'keepassxc', 'keepass', 'proton', 'googlechrome', 'firefoxbrowser', 'lastpass', 'dashlane', 'apple', 'fidoalliance', 'nordpass', 'enpass'];

export function iconDataPlugin(root: string): Plugin {
  return {
    name: 'bettervault-icon-data',

    resolveId(id) {
      return id.startsWith(PREFIX) ? `\0${id}` : undefined;
    },

    async load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return undefined;
      const set = id.slice(PREFIX.length + 1);

      if (set === 'simple' || set === 'brands') {
        const icons = await import('simple-icons') as Record<string, { slug: string; title: string; hex: string; path: string }>;
        const rows = Object.values(icons)
          .filter(icon => icon && typeof icon.path === 'string' && (set === 'simple' || BRAND_SLUGS.includes(icon.slug)))
          .map(icon => [icon.slug, icon.title, icon.hex, icon.path]);
        return `export default ${JSON.stringify(rows)};`;
      }

      if (set === 'phosphor') {
        const { icons } = await import('@phosphor-icons/core') as { icons: Array<{ name: string; tags: string[]; categories: string[] }> };
        const dir = resolve(root, 'node_modules/@phosphor-icons/core/assets/regular');
        const rows = icons.flatMap(meta => {
          const file = join(dir, `${meta.name}.svg`);
          if (!existsSync(file)) return [];
          const body = readFileSync(file, 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
          const keywords = [...meta.tags, ...meta.categories].filter(tag => !tag.startsWith('*')).join(' ');
          return [[meta.name, keywords, body]];
        });
        return `export default ${JSON.stringify(rows)};`;
      }

      throw new Error(`Jeu d'icônes inconnu : ${set}`);
    }
  };
}
