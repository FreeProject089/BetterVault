/**
 * Copie dans le serveur les icônes Phosphor (style « duotone ») utilisées par
 * la page d'accueil et la page des serveurs.
 *
 * Le serveur de production n'a aucun node_modules : les icônes sont donc
 * écrites dans un module TypeScript, régénéré par ce script quand la liste
 * change. Phosphor Icons est sous licence MIT (voir l'en-tête produit).
 *
 * Usage : node scripts/vendor-phosphor.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules/@phosphor-icons/core/assets/duotone');

/** Nom interne → fichier Phosphor */
const ICONS = {
  vault: 'vault',
  password: 'password',
  lockKey: 'lock-key',
  devices: 'devices',
  sync: 'arrows-clockwise',
  files: 'files',
  users: 'users-three',
  fingerprint: 'fingerprint',
  export: 'export',
  server: 'hard-drives',
  shield: 'shield-check',
  key: 'key',
  globe: 'globe-hemisphere-west',
  mapPin: 'map-pin',
  cloud: 'cloud-check'
};

const entries = Object.entries(ICONS).map(([name, file]) => {
  const svg = readFileSync(join(source, `${file}-duotone.svg`), 'utf8');
  // On garde l'intérieur du <svg> : les chemins, avec leur opacité duotone
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
  if (/<script|on\w+=|href=/i.test(inner)) throw new Error(`Icône inattendue : ${file}`);
  return `  ${name}: ${JSON.stringify(inner)}`;
});

const license = readFileSync(join(root, 'node_modules/@phosphor-icons/core/LICENSE'), 'utf8').trim();

const out = `/**
 * Icônes Phosphor, style duotone — produit par scripts/vendor-phosphor.mjs,
 * ne pas modifier à la main.
 *
 * ${license.split('\n').join('\n * ')}
 */

/** Contenu du <svg> (vue 0 0 256 256), à dessiner en currentColor */
export const PHOSPHOR = {
${entries.join(',\n')}
} as const;

export type PhosphorName = keyof typeof PHOSPHOR;
`;

writeFileSync(join(root, 'server/src/phosphorIcons.ts'), out);
console.log(`${entries.length} icônes Phosphor écrites dans server/src/phosphorIcons.ts`);
