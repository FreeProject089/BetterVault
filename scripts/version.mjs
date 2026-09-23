#!/usr/bin/env node
/**
 * Numéro de version de BetterVault, tenu au même endroit partout : serveur,
 * application web, application de bureau et mobile, extension.
 *
 *   node scripts/version.mjs            affiche les versions, échoue si elles diffèrent
 *   node scripts/version.mjs 1.2.0      les passe toutes à 1.2.0
 *   node scripts/version.mjs --tag v1.2.0   échoue si une version diffère du tag (chaîne de publication)
 *
 * Les fichiers sont modifiés ligne à ligne : leur mise en forme ne bouge pas.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Où se trouve la version dans chaque fichier : le motif capture le numéro */
const PLACES = [
  { file: 'package.json', pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: 'package-lock.json', pattern: /^(\{\s*"name":\s*"bettervault",\s*"version":\s*")([^"]+)(")/ },
  { file: 'package-lock.json', pattern: /^(\s*"packages":\s*\{\s*"":\s*\{\s*"name":\s*"bettervault",\s*"version":\s*")([^"]+)(")/m },
  { file: 'src-tauri/Cargo.toml', pattern: /^(\[package\][^[]*?\nversion\s*=\s*")([^"]+)(")/m },
  { file: 'src-tauri/Cargo.lock', pattern: /^(name = "bettervault"\r?\nversion = ")([^"]+)(")/m },
  { file: 'src-tauri/tauri.conf.json', pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: 'extension/manifest.json', pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: 'server/src/app.ts', pattern: /^(export const SERVER_VERSION = ')([^']+)(')/m }
];

const read = file => readFileSync(join(root, file), 'utf8');
const current = () => PLACES.map(p => ({ ...p, version: p.pattern.exec(read(p.file))?.[2] ?? null }));

const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');

if (tagIndex >= 0 || args.length === 0) {
  const expected = tagIndex >= 0 ? String(args[tagIndex + 1] ?? '').replace(/^refs\/tags\//, '').replace(/^v/, '') : null;
  const found = current();
  for (const f of found) console.log(`${(f.version ?? 'introuvable').padEnd(12)} ${f.file}`);
  const versions = new Set(found.map(f => f.version));
  const wrong = expected ? found.filter(f => f.version !== expected) : versions.size > 1 ? found : [];
  if (wrong.length) {
    console.error(expected
      ? `\nLe tag annonce ${expected}, mais ${wrong.map(f => f.file).join(', ')} ne suit pas. Corriger avec : node scripts/version.mjs ${expected}`
      : `\nLes versions diffèrent. Les aligner avec : node scripts/version.mjs <version>`);
    process.exit(1);
  }
  process.exit(0);
}

const next = args[0].replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Version attendue sous la forme 1.2.0, reçu « ${args[0]} »`);
  process.exit(1);
}
const byFile = new Map();
for (const p of PLACES) {
  const text = byFile.get(p.file) ?? read(p.file);
  if (!p.pattern.test(text)) {
    console.error(`Version introuvable dans ${p.file}`);
    process.exit(1);
  }
  byFile.set(p.file, text.replace(p.pattern, (_, before, _old, after) => `${before}${next}${after}`));
}
for (const [file, text] of byFile) writeFileSync(join(root, file), text);
console.log(`Version ${next} dans ${[...byFile.keys()].join(', ')}`);
