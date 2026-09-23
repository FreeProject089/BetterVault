/**
 * Catalogue des textes de l'application, pour traduire BetterVault dans une
 * autre langue depuis l'administration.
 *
 * L'application écrit ses textes de deux façons : `tr('français', 'anglais')`
 * directement dans le code, et le fichier à clés `src/i18n/translations.ts`.
 * Une langue ajoutée se contente d'associer à chaque texte français sa
 * traduction : ce catalogue donne la liste complète, avec l'anglais comme
 * repère pour qui ne lit pas le français.
 *
 * Le code est lu par un vrai analyseur TypeScript (oxc, fourni avec Vite par
 * rolldown) plutôt qu'avec des expressions régulières : les apostrophes
 * échappées, les textes sur plusieurs lignes et les appels imbriqués sont lus
 * comme le compilateur les lit.
 *
 * Un texte construit (`tr(\`${n} fichiers\`, …)`) change à chaque appel : il ne
 * peut pas servir de clé, et reste en anglais dans une langue ajoutée.
 *
 * Usage : node scripts/i18n-catalog.mjs [fichier de sortie]
 */
import { parseSync } from 'rolldown/utils';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Fichiers TypeScript de l'application (pas les tests, pas le serveur) */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

/** Texte d'un argument, seulement s'il est constant */
function literal(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis.map(q => q.value.cooked).join('');
  return null;
}

/** `tr(...)`, `app.tr(...)`, `this.tr(...)` : le nom appelé est `tr` (ou `t`, son alias local) */
function isTrCall(node) {
  if (node.type !== 'CallExpression' || node.arguments.length !== 2) return false;
  const callee = node.callee;
  if (callee.type === 'Identifier') return callee.name === 'tr' || callee.name === 't';
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') return callee.property.name === 'tr';
  return false;
}

/** Parcourt tous les nœuds de l'arbre, sans suivre les liens vers le parent */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  if (typeof node.type === 'string') visit(node);
  for (const key in node) if (key !== 'parent') walk(node[key], visit);
}

function parse(file) {
  const result = parseSync(file, readFileSync(file, 'utf8'));
  if (result.errors.length) throw new Error(`${relative(root, file)} : ${result.errors[0].message}`);
  return result.program;
}

export function extractCalls(file) {
  const found = [];
  let dynamic = 0;
  walk(parse(file), node => {
    if (!isTrCall(node)) return;
    const fr = literal(node.arguments[0]);
    const en = literal(node.arguments[1]);
    if (fr !== null && en !== null) found.push({ fr, en });
    else dynamic++;
  });
  return { found, dynamic };
}

/** Nom d'une propriété d'objet, qu'elle soit écrite `a:` ou `'a':` */
const propName = prop => (prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value));

/** Paires du fichier à clés : on parcourt `fr` et `en` côte à côte */
export function extractKeyed(file) {
  const objets = {};
  walk(parse(file), node => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && (node.id.name === 'fr' || node.id.name === 'en') && node.init?.type === 'ObjectExpression') {
      objets[node.id.name] = node.init;
    }
  });
  const pairs = [];
  const parcourir = (frNode, enNode) => {
    const enProps = new Map(enNode.properties.filter(p => p.type === 'Property').map(p => [propName(p), p.value]));
    for (const prop of frNode.properties.filter(p => p.type === 'Property')) {
      const enValue = enProps.get(propName(prop));
      if (!enValue) continue;
      if (prop.value.type === 'ObjectExpression' && enValue.type === 'ObjectExpression') parcourir(prop.value, enValue);
      else {
        const fr = literal(prop.value);
        const en = literal(enValue);
        if (fr !== null && en !== null) pairs.push({ fr, en });
      }
    }
  };
  if (objets.fr && objets.en) parcourir(objets.fr, objets.en);
  return pairs;
}

export function buildCatalog() {
  const files = sourceFiles(join(root, 'src'));
  const seen = new Map();
  let dynamic = 0;
  const add = ({ fr, en }) => {
    // Un même texte français peut avoir deux traductions anglaises selon le
    // contexte : on garde la première, c'est le repère, pas une contrainte.
    if (fr.trim() && !seen.has(fr)) seen.set(fr, en);
  };
  for (const file of files) {
    const result = extractCalls(file);
    result.found.forEach(add);
    dynamic += result.dynamic;
  }
  extractKeyed(join(root, 'src/i18n/translations.ts')).forEach(add);
  const strings = [...seen].map(([fr, en]) => ({ fr, en })).sort((a, b) => a.fr.localeCompare(b.fr, 'fr'));
  return { format: 'bettervault.i18n-source', version: 1, count: strings.length, dynamic, strings };
}

// Appelé en ligne de commande : on écrit le fichier
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(root, 'public/i18n/source.json'));
  const catalog = buildCatalog();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(catalog, null, 1) + '\n');
  console.log(`Catalogue i18n : ${catalog.count} textes, ${catalog.dynamic} construits (non traduisibles) → ${relative(root, out)}`);
}
