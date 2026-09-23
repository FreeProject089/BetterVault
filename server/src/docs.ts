import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { markdownToHtml } from './legal.ts';
import { CHROME_CSS, pageLangCode, siteFooter, siteHeader, translator, type ChromeContext } from './siteChrome.ts';

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
 * Markdown étendu : blocs de code (```), encadrés et onglets MkDocs, et les
 * blocs B.MD (better.markdown, https://bettercommunity.ch/dev/bmd) les plus
 * utiles à une documentation — encadrés, repliables, questions, étapes,
 * cartes, onglets, colonnes — ainsi que quelques éléments en ligne
 * (:badge, :kbd, :button, ==surligné==).
 *
 * `page` est le chemin de la page affichée (« guide/premiers-pas ») : il sert
 * à transformer les liens relatifs vers d'autres fichiers (« docker.md »,
 * « ../securite.md#sessions ») en adresses de la documentation.
 */
export function renderMarkdown(markdown: string, page = ''): string {
  const blocks: string[] = [];
  let groupe = 0;
  let text = markdown.replace(/\r\n/g, '\n');

  /** Met un morceau de HTML de côté ; `indent` garde la place dans un bloc indenté */
  const bloc = (html: string, indent = '') => {
    blocks.push(html);
    return `\n${indent}@@BLOC${blocks.length - 1}@@\n`;
  };
  /** Même chose, dans le fil d'un paragraphe */
  const enLigne = (html: string) => {
    blocks.push(html);
    return `@@BLOC${blocks.length - 1}@@`;
  };
  const retrait = (body: string) => body.replace(/^[ \t]{1,4}/gm, '');

  /*
   * Les blocs de code sortent d'abord : leur contenu ne doit pas être
   * interprété. Un bloc de code peut être indenté (dans un encadré ou un
   * onglet) : le repère garde la même indentation, sinon il coupait le bloc
   * qui le contient et la suite s'affichait en vrac.
   */
  text = text.replace(/^([ \t]*)```([\w-]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, (_, indent: string, lang: string, code: string) => {
    const sansRetrait = code.split('\n').map(line => (line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n');
    const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    return bloc(`<pre>${label}<code>${escapeHtml(sansRetrait.replace(/\n$/, ''))}</code></pre>`, indent).replace(/^\n/, '').replace(/\n$/, '');
  });

  /*
   * Liens entre pages : écrits comme dans l'éditeur (« docker.md »,
   * « ../securite.md#sessions »), ils deviennent des adresses de la
   * documentation. Avant, ils restaient affichés tels quels, crochets compris.
   */
  const dossier = page.includes('/') ? page.slice(0, page.lastIndexOf('/')) : '';
  text = text.replace(/\]\(((?:\.\.\/|\.\/)?[a-z0-9/_-]+)\.md(#[\w-]+)?\)/gi, (entier, cible: string, ancre = '') => {
    const parts = dossier ? dossier.split('/') : [];
    for (const seg of cible.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    const chemin = parts.join('/');
    return `](/docs/${chemin === 'index' ? '' : chemin}${ancre})`;
  });

  // Éléments B.MD en ligne
  const attrs = (raw = '') => Object.fromEntries([...raw.matchAll(/([\w-]+)=(?:"([^"]*)"|([^\s}]+))/g)].map(m => [m[1], m[2] ?? m[3]]));
  const sureUrl = (url = '') => (/^(https:\/\/|\/(?!\/)|#|mailto:)/.test(url) ? url : '');
  text = text
    .replace(/:badge\[([^\]]+)\](?:\{[^}]*\})?/g, (_, v: string) => enLigne(`<span class="badge">${escapeHtml(v)}</span>`))
    .replace(/:tag\[([^\]]+)\](?:\{[^}]*\})?/g, (_, v: string) => enLigne(`<span class="badge">${escapeHtml(v)}</span>`))
    .replace(/:kbd\[([^\]]+)\]/g, (_, v: string) => enLigne(v.split('+').map(k => `<kbd>${escapeHtml(k.trim())}</kbd>`).join('<span class="kbd-plus">+</span>')))
    .replace(/:(?:button|btn)\[([^\]]+)\]\{([^}]*)\}/g, (entier, label: string, raw: string) => {
      const href = sureUrl(attrs(raw).href);
      return href ? enLigne(`<a class="doc-btn" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`) : entier;
    })
    .replace(/==([^=\n]+)==/g, (_, v: string) => enLigne(`<mark>${escapeHtml(v)}</mark>`));

  const html0 = fragment(text);
  let html = html0;
  /*
   * Un bloc peut en contenir d'autres (du code dans un encadré, un encadré
   * dans un onglet) : on remplace jusqu'à ce qu'il n'en reste aucun.
   */
  for (let tour = 0; tour < 12 && html.includes('@@BLOC'); tour++) {
    html = html
      .replace(/<p>@@BLOC(\d+)@@<\/p>/g, (entier, i: string) => blocks[Number(i)] ?? entier)
      .replace(/@@BLOC(\d+)@@/g, (entier, i: string) => blocks[Number(i)] ?? entier);
  }
  return html;

  /** Un morceau de document : blocs MkDocs et B.MD, puis le Markdown de base */
  function fragment(source: string): string {
    let t = directives(source);

    /*
     * Onglets MkDocs : « === "Android" » suivis de lignes indentées, à la suite.
     * Rendus en onglets CSS (boutons radio) : la page n'exécute aucun script.
     */
    t = t.replace(/(?:^===[ \t]+"[^"]*"[ \t]*\n(?:[ \t]+.*\n?|\n)*)+/gm, entier => {
      const onglets = [...entier.matchAll(/^===[ \t]+"([^"]*)"[ \t]*\n((?:[ \t]+.*\n?|\n)*)/gm)];
      return bloc(tabs(onglets.map(o => [o[1], fragment(retrait(o[2]))])));
    });

    /*
     * Cartes MkDocs : seule la forme exacte « <div class="grid cards" markdown> »
     * est reconnue. Tout autre HTML écrit dans le Markdown reste échappé.
     */
    t = t.replace(/^<div class="grid cards" markdown>[ \t]*\n([\s\S]*?)^<\/div>[ \t]*$/gm, (_, inner: string) =>
      bloc(`<div class="cards">${markdownToHtml(inner)}</div>`));

    // Encadrés MkDocs : « !!! tip "Titre" » suivi de lignes indentées
    t = t.replace(/^!!!\s+(\w+)(?:\s+"([^"]*)")?\n((?:[ \t]+.*\n?|\n)*)/gm, (_, kind: string, title: string | undefined, body: string) =>
      bloc(callout(kind, title, fragment(retrait(body)))));

    return markdownToHtml(t);
  }

  function callout(kind: string, title: string | undefined, inner: string): string {
    const k = CALLOUT_KIND[kind.toLowerCase()] ?? 'note';
    return `<aside class="admo admo-${k}">${title ? `<strong>${escapeHtml(title)}</strong>` : ''}${inner}</aside>`;
  }

  function tabs(onglets: Array<[string, string]>): string {
    const nom = `onglets-${groupe++}`;
    const boutons = onglets.map(([titre], i) =>
      `<input type="radio" name="${nom}" id="${nom}-${i}"${i === 0 ? ' checked' : ''}><label for="${nom}-${i}">${escapeHtml(titre)}</label>`).join('');
    return `<div class="tabs">${boutons}${onglets.map(([, corps]) => `<div class="tab-panel">${corps}</div>`).join('')}</div>`;
  }

  /*
   * Blocs B.MD : « :::nom[Titre]{attributs} » … « ::: ». Ils s'imbriquent
   * (une étape dans des étapes, un onglet dans des onglets) : on repère la
   * fermeture qui correspond en comptant les ouvertures.
   */
  function directives(source: string): string {
    const lines = source.split('\n');
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const open = /^[ \t]*:::([a-z][\w-]*)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?[ \t]*$/i.exec(lines[i]);
      if (!open) { out.push(lines[i]); continue; }
      let depth = 1, j = i + 1;
      for (; j < lines.length; j++) {
        if (/^[ \t]*:::[a-z]/i.test(lines[j])) depth++;
        else if (/^[ \t]*:::[ \t]*$/.test(lines[j]) && --depth === 0) break;
      }
      const body = lines.slice(i + 1, j).join('\n');
      out.push(bloc(directive(open[1].toLowerCase(), open[2], attrs(open[3]), body)));
      i = j;
    }
    return out.join('\n');
  }

  /** Les enfants directs d'un bloc conteneur (étapes, onglets, questions, cartes) */
  function enfants(body: string, noms: string[]): Array<{ title?: string; attrs: Record<string, string>; body: string }> {
    const lines = body.split('\n');
    const list: Array<{ title?: string; attrs: Record<string, string>; body: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const open = /^[ \t]*:::([a-z][\w-]*)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?[ \t]*$/i.exec(lines[i]);
      if (!open || !noms.includes(open[1].toLowerCase())) continue;
      let depth = 1, j = i + 1;
      for (; j < lines.length; j++) {
        if (/^[ \t]*:::[a-z]/i.test(lines[j])) depth++;
        else if (/^[ \t]*:::[ \t]*$/.test(lines[j]) && --depth === 0) break;
      }
      list.push({ title: open[2], attrs: attrs(open[3]), body: lines.slice(i + 1, j).join('\n') });
      i = j;
    }
    return list;
  }

  function directive(name: string, title: string | undefined, a: Record<string, string>, body: string): string {
    if (CALLOUT_KIND[name] || name === 'callout' || name === 'custom') return callout(name, title ?? a.title, fragment(body));
    switch (name) {
      case 'details': case 'collapse': case 'spoiler':
        return `<details class="doc-details"${'open' in a ? ' open' : ''}><summary>${escapeHtml(title || 'Détails')}</summary><div>${fragment(body)}</div></details>`;
      case 'faq':
        return `<div class="doc-faq">${title ? `<p class="doc-faq-title">${escapeHtml(title)}</p>` : ''}${enfants(body, ['q', 'question']).map(q =>
          `<details${'open' in q.attrs ? ' open' : ''}><summary>${escapeHtml(q.title ?? '')}</summary><div>${fragment(q.body)}</div></details>`).join('')}</div>`;
      case 'steps':
        return `${title ? `<p class="doc-steps-title">${escapeHtml(title)}</p>` : ''}<ol class="doc-steps">${enfants(body, ['step']).map(s =>
          `<li${'done' in s.attrs ? ' class="done"' : ''}>${s.title ? `<strong>${escapeHtml(s.title)}</strong>` : ''}${fragment(s.body)}</li>`).join('')}</ol>`;
      case 'cards': case 'grid':
        return `<div class="doc-cards"${a.cols ? ` style="--cols:${Math.min(4, Math.max(1, Number(a.cols) || 3))}"` : ''}>${enfants(body, ['card', 'ref']).map(c => card(c.title, c.attrs, c.body)).join('') || fragment(body)}</div>`;
      case 'card': case 'ref':
        return `<div class="doc-cards">${card(title, a, body)}</div>`;
      case 'tabs':
        return tabs(enfants(body, ['tab']).map(o => [o.attrs.title ?? o.title ?? '', fragment(o.body)]));
      case 'columns': case 'row':
        return `<div class="doc-columns">${enfants(body, ['column', 'col']).map(c => `<div>${fragment(c.body)}</div>`).join('')}</div>`;
      case 'center': case 'left': case 'right':
        return `<div style="text-align:${name}">${fragment(body)}</div>`;
      default:
        // Bloc inconnu : son contenu reste lisible, sans la syntaxe
        return fragment(body);
    }
  }

  function card(title: string | undefined, a: Record<string, string>, body: string): string {
    const href = sureUrl(a.href?.replace(/^([a-z0-9/_-]+)\.md$/i, '/docs/$1'));
    const inner = `${title ? `<strong>${escapeHtml(title)}</strong>` : ''}${fragment(body)}`;
    return href ? `<a class="doc-card" href="${escapeHtml(href)}">${inner}<span class="doc-card-go" aria-hidden="true">→</span></a>` : `<div class="doc-card">${inner}</div>`;
  }
}

/** Noms d'encadrés B.MD et MkDocs → famille de couleur */
const CALLOUT_KIND: Record<string, string> = {
  note: 'note', info: 'note', abstract: 'note', callout: 'note', custom: 'note', question: 'note',
  tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', example: 'tip',
  warning: 'warning', caution: 'warning', important: 'warning', attention: 'warning',
  danger: 'danger', error: 'danger', failure: 'danger', bug: 'danger'
};

export interface DocsContext {
  root: string;
  locale: 'fr' | 'en';
  appAvailable: boolean;
  /** En-tête et pied communs au site ; sans eux, une barre minimale */
  chrome?: ChromeContext;
}

/**
 * Ordre et titres du sommaire, repris de `mkdocs.yml` quand il est là : c'est
 * l'ordre pensé pour la lecture (« Premiers pas » avant « Raccourcis »), pas
 * l'ordre alphabétique des fichiers.
 */
function navOrder(root: string): Map<string, { index: number; title: string }> {
  const order = new Map<string, { index: number; title: string }>();
  const file = join(root, '..', 'mkdocs.yml');
  if (!existsSync(file)) return order;
  let index = 0;
  for (const match of readFileSync(file, 'utf8').matchAll(/^\s*-\s+(.+?):\s+([a-z0-9/-]+)\.md\s*$/gm)) {
    order.set(match[2], { index: index++, title: match[1].replace(/^["']|["']$/g, '').trim() });
  }
  return order;
}

const SECTION_ICONS: Record<string, string> = {
  '': '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  guide: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 7h6"/>',
  deploiement: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  applications: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  developpement: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"/>'
};
const sectionIcon = (section: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SECTION_ICONS[section] ?? SECTION_ICONS.guide}</svg>`;

/** Page demandée, ou null si elle n'existe pas (ou sort du dossier) */
export function renderDocPage(path: string, ctx: DocsContext): string | null {
  const wanted = path || 'index';
  if (!PATH.test(wanted)) return null;
  const file = normalize(join(ctx.root, `${wanted}.md`));
  if (!file.startsWith(ctx.root + sep) || !existsSync(file)) return null;

  const nav = navOrder(ctx.root);
  const pages = listDocs(ctx.root)
    .map(p => ({ ...p, title: nav.get(p.path)?.title ?? p.title }))
    .sort((a, b) => (nav.get(a.path)?.index ?? 1e6) - (nav.get(b.path)?.index ?? 1e6) || 0);
  const at = pages.findIndex(p => p.path === wanted);
  const current = pages[at];
  const markdown = readFileSync(file, 'utf8');
  const fr = ctx.locale === 'fr';
  const t = ctx.chrome ? translator(ctx.chrome) : (a: string, b: string) => (fr ? a : b);
  const sectionLabel = (s: string) => SECTIONS[s]?.[fr ? 0 : 1] ?? s;

  const sections = [...new Set(pages.map(p => p.section))].map(section => {
    const links = pages.filter(p => p.section === section).map(p =>
      `<a href="/docs/${p.path}"${p.path === wanted ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a>`).join('');
    // Chaque catégorie se replie ; celle de la page affichée est ouverte
    const ouverte = pages.some(p => p.section === section && p.path === wanted) || section === '';
    return `<details class="doc-group"${ouverte ? ' open' : ''}><summary>${sectionIcon(section)}<span>${escapeHtml(sectionLabel(section))}</span><svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></summary><div class="doc-links">${links}</div></details>`;
  }).join('');

  const content = renderMarkdown(markdown, wanted);
  // « Sur cette page » : les titres de niveau 2 de la page
  const headings = [...content.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(m => [m[1], m[2].replace(/<[^>]+>/g, '')]);
  const onPage = headings.length > 1
    ? `<aside class="onpage" aria-label="${t('Sur cette page', 'On this page')}"><span>${t('Sur cette page', 'On this page')}</span>${headings.map(([id, text]) => `<a href="#${id}">${text}</a>`).join('')}</aside>`
    : '<aside class="onpage"></aside>';

  const prev = at > 0 ? pages[at - 1] : null;
  const next = at >= 0 && at < pages.length - 1 ? pages[at + 1] : null;
  const pager = `<nav class="pager" aria-label="${t('Pages voisines', 'Adjacent pages')}">
    ${prev ? `<a class="prev" href="/docs/${prev.path === 'index' ? '' : prev.path}"><small>← ${t('Précédent', 'Previous')}</small><b>${escapeHtml(prev.title)}</b></a>` : '<span></span>'}
    ${next ? `<a class="next" href="/docs/${next.path}"><small>${t('Suivant', 'Next')} →</small><b>${escapeHtml(next.title)}</b></a>` : '<span></span>'}
  </nav>`;

  const crumbs = `<nav class="crumbs" aria-label="${t('Fil d’Ariane', 'Breadcrumb')}"><a href="/docs">Documentation</a>${current && current.section ? `<span>/</span><span>${escapeHtml(sectionLabel(current.section))}</span>` : ''}</nav>`;

  const header = ctx.chrome
    ? siteHeader(ctx.chrome, 'docs')
    : `<header class="site-bar"><div class="site-bar-in"><a class="site-brand" href="/"><picture><source srcset="/admin/logo-on-light.svg" media="(prefers-color-scheme: light)"><img src="/admin/logo-on-dark.svg" alt="" width="28" height="28"></picture><span>BetterVault</span></a><nav class="site-links"><a href="/docs" aria-current="page">Documentation</a></nav>${ctx.appAvailable ? `<div class="site-actions"><a class="site-cta" href="/app">${t('Premiers pas', 'Get started')}<span aria-hidden="true">→</span></a></div>` : ''}</div></header>`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(ctx.chrome ? pageLangCode(ctx.chrome) : ctx.locale)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(current?.title ?? 'Documentation')} · BetterVault</title>
<link rel="icon" type="image/svg+xml" href="/admin/logo-on-dark.svg" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/admin/logo-on-light.svg" media="(prefers-color-scheme: light)">
<style>
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#7773e8;--code:#0b0f14;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#ffffff;--card:#f6f8fa;--border:#d8dee4;--text:#1f2328;--muted:#59636e;--accent:#5754c7;--code:#f6f8fa;color-scheme:light}}
*{box-sizing:border-box}
html{scroll-padding-top:84px;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
${CHROME_CSS}
.docs-hero{border-bottom:1px solid var(--border);background:radial-gradient(700px 240px at 15% 0%,color-mix(in srgb,var(--accent) 16%,transparent),transparent),var(--bg)}
.docs-hero-in{max-width:1320px;margin:0 auto;padding:16px 20px;display:flex;align-items:center;gap:12px;font-size:14px;color:var(--muted)}
.docs-hero-in b{color:var(--text)}
.shell{max-width:1320px;margin:0 auto;padding:0 20px;display:grid;gap:40px}
.sidebar{padding:24px 0}
.sidebar nav{display:flex;flex-direction:column;gap:6px;font-size:14px}
.sidenav{display:none!important}
.doc-group{border-radius:8px}
.doc-group>summary{list-style:none;display:flex;align-items:center;gap:8px;min-height:36px;padding:0 8px;border-radius:8px;cursor:pointer;color:var(--text);font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;user-select:none}
.doc-group>summary::-webkit-details-marker{display:none}
.doc-group>summary:hover{background:color-mix(in srgb,var(--muted) 10%,transparent)}
.doc-group>summary>svg:first-child{color:var(--accent);flex:0 0 auto}
.doc-group>summary span{flex:1}
.doc-group .chev{color:var(--muted);transition:transform .2s}
.doc-group[open] .chev{transform:rotate(90deg)}
.doc-links{display:flex;flex-direction:column;gap:1px;margin:2px 0 6px}
.doc-group[open] .doc-links{animation:fold .22s ease-out}
@keyframes fold{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.doc-links a{display:flex;align-items:center;min-height:34px;padding:5px 10px 5px 12px;margin-left:15px;border-left:1px solid var(--border);color:var(--muted);text-decoration:none;transition:color .15s,border-color .15s,background-color .15s}
.doc-links a:hover{color:var(--text);border-left-color:var(--muted)}
.doc-links a[aria-current]{color:var(--accent);border-left:2px solid var(--accent);padding-left:11px;font-weight:600;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 12%,transparent),transparent)}
.toc{border:1px solid var(--border);border-radius:12px;background:var(--card);padding:4px 12px;margin-top:16px}
.toc summary{padding:10px 2px;font-weight:600;cursor:pointer;min-height:44px;display:flex;align-items:center}
.toc[open] summary{margin-bottom:10px;border-bottom:1px solid var(--border)}
.doc{min-width:0;padding:28px 0 72px;max-width:780px}
.crumbs{display:flex;flex-wrap:wrap;gap:8px;font-size:13px;color:var(--muted);margin-bottom:10px}
.crumbs a{color:var(--muted);text-decoration:none}.crumbs a:hover{color:var(--accent)}
.doc h1{font-size:clamp(28px,4vw,40px);line-height:1.15;letter-spacing:-.025em;margin:0 0 18px}
.doc h1+p{font-size:18px;color:var(--muted)}
.doc h2{margin:48px 0 12px;padding-top:20px;border-top:1px solid var(--border);font-size:24px;letter-spacing:-.015em}
.doc h3{margin:30px 0 8px;font-size:18px}
.doc h2 a,.doc h3 a{color:inherit}
a{color:var(--accent);text-underline-offset:3px}
code{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;font-size:.86em;padding:2px 6px;border-radius:6px;background:color-mix(in srgb,var(--accent) 10%,var(--card));border:1px solid color-mix(in srgb,var(--accent) 18%,var(--border))}
pre{position:relative;background:var(--code);border:1px solid var(--border);border-radius:9px;padding:16px 18px;overflow-x:auto;margin:18px 0}
pre::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:9px 0 0 9px;background:var(--accent);opacity:.8}
pre code{border:0;padding:0;background:none;font-size:13.5px;line-height:1.6}
.table{overflow-x:auto;margin:18px 0;border:1px solid var(--border);border-radius:9px}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{border-bottom:1px solid var(--border);padding:10px 14px;text-align:left;vertical-align:top}
tr:last-child td{border-bottom:0}
th{background:var(--card);font-size:13px;font-weight:700;letter-spacing:.02em}
tbody tr:hover td{background:color-mix(in srgb,var(--card) 60%,transparent)}
.admo{margin:20px 0;padding:14px 16px 14px 46px;position:relative;border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border));border-radius:9px;background:color-mix(in srgb,var(--accent) 7%,var(--bg))}
.admo::before{content:"i";position:absolute;left:14px;top:14px;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font:700 12px/1 Georgia,serif;color:#fff;background:var(--accent)}
.admo strong{display:block;margin-bottom:4px}.admo p{margin:.3em 0}.admo p:last-child{margin-bottom:0}
.admo-warning,.admo-danger,.admo-caution{border-color:color-mix(in srgb,#d29922 45%,var(--border));background:color-mix(in srgb,#d29922 8%,var(--bg))}
.admo-warning::before,.admo-danger::before,.admo-caution::before{content:"!";background:#d29922}
.admo-tip,.admo-success{border-color:color-mix(in srgb,#3fb950 45%,var(--border));background:color-mix(in srgb,#3fb950 7%,var(--bg))}
.admo-tip::before,.admo-success::before{content:"✓";background:#3fb950}
hr{border:none;border-top:1px solid var(--border);margin:36px 0}
.tabs{margin:18px 0;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card)}
.tabs>input{position:absolute;opacity:0;pointer-events:none}
.tabs>label{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;cursor:pointer;color:var(--muted);font-size:14px;font-weight:600;border-bottom:2px solid transparent}
.tabs>input:checked+label{color:var(--text);border-bottom-color:var(--accent)}
.tabs>input:focus-visible+label{outline:2px solid var(--accent);outline-offset:-2px}
.tab-panel{display:none;padding:4px 16px 12px;border-top:1px solid var(--border);background:var(--bg)}
.tabs>input:nth-of-type(1):checked~.tab-panel:nth-of-type(1),.tabs>input:nth-of-type(2):checked~.tab-panel:nth-of-type(2),.tabs>input:nth-of-type(3):checked~.tab-panel:nth-of-type(3),.tabs>input:nth-of-type(4):checked~.tab-panel:nth-of-type(4),.tabs>input:nth-of-type(5):checked~.tab-panel:nth-of-type(5),.tabs>input:nth-of-type(6):checked~.tab-panel:nth-of-type(6){display:block}
.cards>ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.cards>ul>li{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin:0;transition:border-color .15s,transform .15s}
.cards>ul>li:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));transform:translateY(-2px)}
.pager{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:56px}
.pager a{display:flex;flex-direction:column;gap:2px;padding:14px 18px;border:1px solid var(--border);border-radius:9px;text-decoration:none;transition:border-color .15s}
.pager a:hover{border-color:var(--accent)}
.pager small{color:var(--muted);font-size:12.5px}.pager b{color:var(--text)}
.pager .next{text-align:right}
.edit{display:inline-block;margin-top:18px;font:12px ui-monospace,Menlo,Consolas,monospace;color:var(--muted);text-decoration:none}
.onpage{display:none}
.badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:6px;font-size:12px;font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent);vertical-align:1px}
kbd{display:inline-block;min-width:22px;padding:1px 6px;border:1px solid var(--border);border-bottom-width:2px;border-radius:6px;background:var(--card);font:600 12px/1.6 ui-monospace,Menlo,Consolas,monospace;text-align:center}
.kbd-plus{margin:0 3px;color:var(--muted)}
mark{background:linear-gradient(104deg,transparent .5%,color-mix(in srgb,#ffc62e 55%,transparent) 2.5%,color-mix(in srgb,#ffc62e 45%,transparent) 96%,transparent 98%);color:inherit;padding:0 .15em;border-radius:3px}
.doc-btn{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 16px;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none}
.doc-btn:hover{filter:brightness(1.08)}
.code-lang{position:absolute;top:8px;right:12px;font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.admo-note{}
.admo-danger{border-color:color-mix(in srgb,#f85149 45%,var(--border));background:color-mix(in srgb,#f85149 7%,var(--bg))}
.admo-danger::before{content:"×";background:#f85149}
.doc-details,.doc-faq details{margin:12px 0;border:1px solid var(--border);border-radius:10px;background:var(--card);overflow:hidden}
.doc-details>summary,.doc-faq summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:0 16px;cursor:pointer;font-weight:600}
.doc-details>summary::-webkit-details-marker,.doc-faq summary::-webkit-details-marker{display:none}
.doc-details>summary::after,.doc-faq summary::after{content:"";width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg) translateY(-2px);transition:transform .2s;flex:0 0 auto}
.doc-details[open]>summary::after,.doc-faq details[open] summary::after{transform:rotate(-135deg)}
.doc-details>div,.doc-faq details>div{padding:0 16px 12px;border-top:1px solid var(--border)}
.doc-faq{margin:16px 0}.doc-faq details{margin:0 0 -1px;border-radius:0}.doc-faq details:first-of-type{border-radius:10px 10px 0 0}.doc-faq details:last-of-type{border-radius:0 0 10px 10px}
.doc-faq-title,.doc-steps-title{font-weight:700;margin:18px 0 8px}
.doc-steps{list-style:none;counter-reset:step;padding:0;margin:18px 0}
.doc-steps>li{position:relative;counter-increment:step;padding:0 0 18px 44px;margin:0}
.doc-steps>li::before{content:counter(step);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);font-weight:800;font-size:13px}
.doc-steps>li::after{content:"";position:absolute;left:13.5px;top:32px;bottom:4px;width:1px;background:var(--border)}
.doc-steps>li:last-child::after{display:none}
.doc-steps>li.done::before{content:"✓";background:#3fb950;color:#fff}
.doc-steps>li>strong{display:block;line-height:28px}
.doc-steps>li>p:first-of-type{margin-top:2px}
.doc-cards{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:12px;margin:18px 0}
.doc-card{position:relative;display:flex;flex-direction:column;gap:4px;padding:16px 40px 16px 18px;border:1px solid var(--border);border-radius:10px;background:var(--card);color:var(--text);text-decoration:none;transition:border-color .15s,transform .15s,box-shadow .15s}
.doc-card strong{font-size:15.5px}
.doc-card p{margin:0;color:var(--muted);font-size:14.5px}
a.doc-card:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 14px 30px -22px var(--accent)}
.doc-card-go{position:absolute;right:16px;top:16px;color:var(--accent);font-weight:700;transition:transform .15s}
a.doc-card:hover .doc-card-go{transform:translateX(3px)}
.doc-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;margin:14px 0}
@media (max-width:640px){.doc-cards{grid-template-columns:1fr}}
@media (min-width:1000px){
  .shell{grid-template-columns:260px minmax(0,1fr)}
  .sidebar{position:sticky;top:64px;align-self:start;max-height:calc(100vh - 64px);overflow-y:auto;padding-right:8px;border-right:1px solid var(--border)}
  .toc{display:none}
  .sidenav{display:flex!important}
}
@media (min-width:1260px){
  .shell{grid-template-columns:260px minmax(0,1fr) 220px}
  .onpage{display:flex;flex-direction:column;gap:2px;position:sticky;top:64px;align-self:start;padding:28px 0;font-size:13.5px}
  .onpage span{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px}
  .onpage a{color:var(--muted);text-decoration:none;padding:4px 0 4px 12px;border-left:1px solid var(--border)}
  .onpage a:hover{color:var(--text);border-left-color:var(--accent)}
}
@media (max-width:560px){.doc{font-size:15.5px}pre{padding:12px 14px;font-size:12.5px}.pager{grid-template-columns:1fr}}
</style>
<script src="/site.js" defer></script>
</head>
<body>
${header}
<div class="shell">
  <div class="sidebar">
    <details class="toc" aria-label="${t('Sommaire', 'Contents')}">
      <summary>${t('Sommaire de la documentation', 'Documentation contents')}</summary>
      <nav>${sections}</nav>
    </details>
    <nav class="sidenav" aria-label="${t('Sommaire', 'Contents')}">${sections}</nav>
  </div>
  <main class="doc" id="contenu">
    ${crumbs}
    ${content}
    ${pager}
  </main>
  ${onPage}
</div>
${ctx.chrome ? siteFooter(ctx.chrome) : ''}
</body>
</html>`;
}
