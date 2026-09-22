import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(html).toContain('<pre><code>docker compose up -d &amp;&amp; echo &quot;&lt;script&gt;&quot;</code></pre>');
    expect(html).toContain('class="admo admo-tip"');
    expect(html).toContain('<strong>Astuce</strong>');
    expect(html).not.toContain('<script>');
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
