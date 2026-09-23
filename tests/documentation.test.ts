import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { listDocs, renderDocPage, renderMarkdown } from '../server/src/docs.ts';

/**
 * Documentation servie par le serveur : le chemin vient de l'URL, donc rien ne
 * doit pouvoir sortir du dossier, et le Markdown ne doit pas injecter de HTML.
 */

const root = mkdtempSync(join(tmpdir(), 'bv-docs-'));
writeFileSync(join(root, 'index.md'), '# Accueil\n\nBonjour.\n');
mkdirSync(join(root, 'guide'));
writeFileSync(join(root, 'guide', 'premiers-pas.md'), '# Premiers pas\n\nTexte.\n');
writeFileSync(join(root, 'guide', 'piege.md'), '# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n');

const ctx = { root, locale: 'fr' as const, appAvailable: true };

describe('Documentation servie par le serveur', () => {
  it('range les pages par section, titre lu dans le fichier', () => {
    const pages = listDocs(root);
    expect(pages[0].path).toBe('index');
    expect(pages.find(p => p.path === 'guide/premiers-pas')?.title).toBe('Premiers pas');
    expect([...new Set(pages.map(p => p.section))]).toEqual(['', 'guide']);
  });

  it('rend les blocs de code et les encadrés sans les interpréter', () => {
    const html = renderMarkdown('# T\n\n```bash\ndocker compose up -d && echo "<script>"\n```\n\n!!! tip "Astuce"\n    Un conseil.\n');
    expect(html).toContain('<code>docker compose up -d &amp;&amp; echo &quot;&lt;script&gt;&quot;</code></pre>');
    expect(html).toContain('<span class="code-lang">bash</span>');
    expect(html).toContain('class="admo admo-tip"');
    expect(html).toContain('<strong>Astuce</strong>');
    expect(html).not.toContain('<script>');
  });

  it('comprend les blocs B.MD et les liens relatifs entre pages', () => {
    const html = renderMarkdown([
      'Voir [Docker](docker.md#volumes) et [la sécurité](../securite.md).',
      '',
      ':::steps',
      ':::step[Installer]',
      'Lancer :kbd[Ctrl+K].',
      ':::',
      ':::',
      '',
      ':::faq',
      ':::q[Une question ?]',
      'Une réponse ==importante==.',
      ':::',
      ':::',
      '',
      ':::warning[Attention]',
      'Texte.',
      ':::'
    ].join('\n'), 'deploiement/installation');
    expect(html).toContain('href="/docs/deploiement/docker#volumes"');
    expect(html).toContain('href="/docs/securite"');
    expect(html).toContain('<ol class="doc-steps"><li><strong>Installer</strong>');
    expect(html).toContain('<kbd>Ctrl</kbd>');
    expect(html).toContain('<summary>Une question ?</summary>');
    expect(html).toContain('<mark>importante</mark>');
    expect(html).toContain('class="admo admo-warning"');
    expect(html).not.toContain(':::');
  });

  it('échappe le HTML venu du Markdown', () => {
    const html = renderDocPage('guide/piege', ctx)!;
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('refuse tout chemin qui sortirait du dossier', () => {
    for (const path of ['../server/.env', '..%2f..%2fetc/passwd', '/etc/passwd', 'guide/../../secret', 'guide/sous/trop/profond', 'Guide/Majuscule']) {
      expect(renderDocPage(path, ctx)).toBeNull();
    }
    expect(renderDocPage('inconnu', ctx)).toBeNull();
  });

  it('affiche la page demandée avec son sommaire', () => {
    const html = renderDocPage('guide/premiers-pas', ctx)!;
    expect(html).toContain('Premiers pas');
    expect(html).toContain('href="/docs/index"');
    expect(html).toContain('aria-current="page"');
  });
});

describe('Cohérence de la documentation livrée', () => {
  it('chaque lien interne mène à une page qui existe', async () => {
    const { readFileSync, existsSync, readdirSync, statSync } = await import('node:fs');
    const { join, dirname, normalize } = await import('node:path');

    const pages: string[] = [];
    const parcourir = (dir: string) => {
      for (const nom of readdirSync(dir)) {
        const chemin = join(dir, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (nom.endsWith('.md')) pages.push(chemin);
      }
    };
    parcourir('docs');

    const casses: string[] = [];
    for (const page of pages) {
      const contenu = readFileSync(page, 'utf8');
      for (const lien of contenu.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
        const cible = normalize(join(dirname(page), lien[1]));
        if (!existsSync(cible)) casses.push(`${page} → ${lien[1]}`);
      }
    }
    expect(casses).toEqual([]);
  });

  it('chaque page du sommaire MkDocs existe', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const nav = readFileSync('mkdocs.yml', 'utf8');
    const manquantes = [...nav.matchAll(/:\s*((?:guide|deploiement|applications|developpement)\/[\w-]+\.md|[\w-]+\.md)\s*$/gm)]
      .map(m => m[1])
      .filter(rel => !existsSync(join('docs', rel)));
    expect(manquantes).toEqual([]);
  });
});

describe('Rendu de chaque page de la documentation', () => {
  const root = resolve(__dirname, '../docs');
  const pages = listDocs(root);

  it('n’affiche aucune syntaxe MkDocs ni balise en texte brut', () => {
    const fautes: string[] = [];
    for (const page of pages) {
      const html = renderDocPage(page.path, { root, locale: 'fr', appAvailable: true })!;
      const corps = html.slice(html.indexOf('<main'));
      if (/=== &quot;|=== "/.test(corps)) fautes.push(`${page.path} : onglet MkDocs en texte`);
      if (corps.includes('@@BLOC')) fautes.push(`${page.path} : repère interne visible`);
      if (/&lt;\/?div/.test(corps)) fautes.push(`${page.path} : balise div en texte`);
    }
    expect(fautes).toEqual([]);
  });

  it('ferme chaque balise qu’elle ouvre', () => {
    const fautes: string[] = [];
    for (const page of pages) {
      const html = renderDocPage(page.path, { root, locale: 'fr', appAvailable: true })!;
      for (const tag of ['div', 'section', 'aside', 'details', 'ul', 'ol', 'table', 'pre', 'nav', 'main']) {
        const ouvertes = (html.match(new RegExp(`<${tag}(?=[ \\t\\n>])`, 'g')) ?? []).length;
        const fermees = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
        if (ouvertes !== fermees) fautes.push(`${page.path} : <${tag}> ${ouvertes} ouvertes, ${fermees} fermées`);
      }
    }
    expect(fautes).toEqual([]);
  });

  it('rend les onglets sans script, le premier ouvert', () => {
    const html = renderDocPage('applications/bureau-mobile', { root, locale: 'fr', appAvailable: true })!;
    expect(html).toMatch(/<div class="tabs"><input type="radio" name="onglets-0" id="onglets-0-0" checked><label for="onglets-0-0">Android<\/label>/);
    // Seul le script du site, servi par le serveur : les onglets, eux, n’en ont pas besoin
    expect(html.match(/<script[^>]*>/gi)).toEqual([expect.stringMatching(/^<script src="\/site\.js\?v=[0-9a-f]{10}" defer>$/)]);
  });
});
