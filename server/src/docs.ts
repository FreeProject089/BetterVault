import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { markdownToHtml } from './legal.ts';

/**
 * Documentation servie par le serveur, directement depuis les fichiers Markdown
 * du dossier `docs`. Aucun générateur à lancer : l'image Docker contient les
 * fichiers, le serveur les met en page à la demande.
 *
 * Les chemins viennent de l'URL : ils sont vérifiés (lettres, chiffres, tirets,
 * un seul niveau de dossier) puis recalculés à partir du dossier de la
 * documentation, si bien qu'aucune requête ne peut sortir de ce dossier.
 */

const PATH = /^[a-z0-9-]+(?:\/[a-z0-9-]+)?$/;

const SECTIONS: Record<string, [string, string]> = {
  '': ['Général', 'General'],
  guide: ['Guide d’utilisation', 'User guide'],
  deploiement: ['Installer un serveur', 'Run a server'],
  applications: ['Applications', 'Apps'],
  developpement: ['Développement', 'Development']
};

export interface DocPage {
  path: string;
  title: string;
  section: string;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const titleOf = (markdown: string, fallback: string) =>
  (/^#\s+(.+)$/m.exec(markdown)?.[1] ?? fallback).replace(/[*`]/g, '').trim();

/** Toutes les pages, rangées par section, dans l'ordre du sommaire */
export function listDocs(root: string): DocPage[] {
  if (!existsSync(root)) return [];
  const pages: DocPage[] = [];
  const read = (section: string) => {
    const dir = section ? join(root, section) : root;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.md')) continue;
      const slug = name.slice(0, -3);
      const path = section ? `${section}/${slug}` : slug;
      if (!PATH.test(path)) continue;
      pages.push({ path, title: titleOf(readFileSync(join(dir, name), 'utf8').slice(0, 2000), slug), section });
    }
  };
  read('');
  for (const name of readdirSync(root).sort()) {
    if (statSync(join(root, name)).isDirectory() && /^[a-z0-9-]+$/.test(name)) read(name);
  }
  // « index » d'abord, puis les sections connues dans l'ordre choisi
  const order = Object.keys(SECTIONS);
  return pages.sort((a, b) => {
    const sa = order.indexOf(a.section), sb = order.indexOf(b.section);
    if (sa !== sb) return (sa < 0 ? order.length : sa) - (sb < 0 ? order.length : sb);
    if (a.path === 'index') return -1;
    if (b.path === 'index') return 1;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Markdown étendu : blocs de code (```) et encadrés MkDocs (!!! note "Titre"),
 * que le rendu des documents légaux ne connaît pas.
 */
export function renderMarkdown(markdown: string): string {
  const blocks: string[] = [];
  let text = markdown.replace(/\r\n/g, '\n');

  // Les blocs de code sortent d'abord : leur contenu ne doit pas être interprété
  text = text.replace(/```[a-z]*\n([\s\S]*?)```/g, (_, code: string) => {
    blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\n@@BLOC${blocks.length - 1}@@\n`;
  });

  // Encadrés : « !!! tip "Titre" » suivi de lignes indentées
  text = text.replace(/^!!!\s+(\w+)(?:\s+"([^"]*)")?\n((?:[ \t]+.*\n?|\n)*)/gm, (_, kind: string, title: string | undefined, body: string) => {
    const inner = markdownToHtml(body.replace(/^[ \t]{1,4}/gm, ''));
    blocks.push(`<aside class="admo admo-${escapeHtml(kind)}">${title ? `<strong>${escapeHtml(title)}</strong>` : ''}${inner}</aside>`);
    return `\n@@BLOC${blocks.length - 1}@@\n`;
  });

  return markdownToHtml(text).replace(/<p>@@BLOC(\d+)@@<\/p>/g, (_, i: string) => blocks[Number(i)]);
}

export interface DocsContext {
  root: string;
  locale: 'fr' | 'en';
  appAvailable: boolean;
}

/** Page demandée, ou null si elle n'existe pas (ou sort du dossier) */
export function renderDocPage(path: string, ctx: DocsContext): string | null {
  const wanted = path || 'index';
  if (!PATH.test(wanted)) return null;
  const file = normalize(join(ctx.root, `${wanted}.md`));
  if (!file.startsWith(ctx.root + sep) || !existsSync(file)) return null;

  const pages = listDocs(ctx.root);
  const current = pages.find(p => p.path === wanted);
  const markdown = readFileSync(file, 'utf8');
  const fr = ctx.locale === 'fr';
  const t = (a: string, b: string) => (fr ? a : b);

  const sections = [...new Set(pages.map(p => p.section))].map(section => {
    const label = SECTIONS[section]?.[fr ? 0 : 1] ?? section;
    const links = pages.filter(p => p.section === section).map(p =>
      `<a href="/docs/${p.path}"${p.path === wanted ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a>`).join('');
    return `<div class="doc-group"><span>${escapeHtml(label)}</span>${links}</div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${ctx.locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(current?.title ?? 'Documentation')} · BetterVault</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#7773e8;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f8fa;--card:#fff;--border:#d0d7de;--text:#1f2328;--muted:#656d76;--accent:#5754c7;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--card);border-bottom:1px solid var(--border)}
header div{max-width:1160px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:12px}
header img{width:26px;height:26px}header strong{margin-right:auto}
.shell{max-width:1160px;margin:0 auto;padding:24px 16px 64px;display:grid;gap:28px}
nav{display:flex;flex-direction:column;gap:18px;font-size:14px}
.doc-group{display:flex;flex-direction:column;gap:2px}
.doc-group span{color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:0 8px 4px}
nav a{display:flex;align-items:center;min-height:44px;padding:8px 10px;border-radius:8px;color:var(--text);text-decoration:none}
.toc{border:1px solid var(--border);border-radius:12px;background:var(--card);padding:4px 12px}
.toc summary{padding:10px 2px;font-weight:600;cursor:pointer}
.toc[open] summary{margin-bottom:6px;border-bottom:1px solid var(--border)}
nav a:hover{background:var(--card)}
nav a[aria-current]{background:var(--accent);color:#fff;font-weight:600}
main{min-width:0}h1{font-size:30px;line-height:1.2;margin:0 0 16px}h2{margin-top:36px;font-size:21px}h3{font-size:17px}
a{color:var(--accent)}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;padding:1px 5px;border:1px solid var(--border);border-radius:5px}
pre{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;overflow-x:auto}
pre code{border:0;padding:0;font-size:13px;line-height:1.5}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}
th,td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}th{background:var(--card)}
.admo{margin:16px 0;padding:12px 14px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:8px;background:var(--card)}
.admo strong{display:block;margin-bottom:4px}.admo p:last-child{margin-bottom:0}
.admo-warning,.admo-danger{border-left-color:#d29922}.admo-tip,.admo-success{border-left-color:#3fb950}
hr{border:none;border-top:1px solid var(--border);margin:32px 0}
.btn{display:inline-flex;align-items:center;min-height:38px;padding:0 14px;border-radius:9px;border:1px solid var(--border);color:var(--text);text-decoration:none;font-size:14px;font-weight:600}
@media (min-width:1000px){
  .shell{grid-template-columns:248px minmax(0,1fr)}
  /* Sur grand écran le sommaire est toujours là, sans dépliant */
  .toc{border:0;background:none;padding:0;position:sticky;top:74px;align-self:start;max-height:calc(100vh - 96px);overflow-y:auto}
  .toc summary{display:none}
  nav a{min-height:36px;padding:6px 10px}
}
@media (max-width:560px){main{font-size:15.5px}h1{font-size:26px}pre{padding:12px;font-size:12.5px}}
</style>
</head>
<body>
<header><div>
  <img src="/admin/logo-on-dark.svg" alt="" width="26" height="26">
  <strong>BetterVault · ${t('Documentation', 'Documentation')}</strong>
  ${ctx.appAvailable ? `<a class="btn" href="/">${t('Ouvrir l’application', 'Open the app')}</a>` : ''}
  <a class="btn" href="/about">${t('À propos', 'About')}</a>
</div></header>
<div class="shell">
  <details class="toc" aria-label="${t('Sommaire', 'Contents')}">
    <summary>${t('Sommaire', 'Contents')}</summary>
    <nav>${sections}</nav>
  </details>
  <main>${renderMarkdown(markdown)}</main>
</div>
</body>
</html>`;
}
