import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * L'écran de lancement vit dans index.html, hors de toute logique : il doit
 * s'afficher au premier rendu, puis disparaître. Ces vérifications gardent les
 * trois propriétés dont dépend ce comportement — elles sont faciles à casser
 * d'un simple nettoyage de fichier.
 */

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const main = readFileSync(resolve(__dirname, '../src/main.ts'), 'utf8');
const css = readFileSync(resolve(__dirname, '../public/splash.css'), 'utf8');

describe('Écran de lancement', () => {
  it('est visible dès le premier rendu, sans attendre le script principal', () => {
    const balise = html.match(/<div id="splash"[^>]*>/)?.[0] ?? '';
    expect(balise).not.toBe('');
    // Un attribut `hidden` le rendrait invisible exactement quand il sert
    expect(balise).not.toMatch(/\bhidden\b/);
    // Les styles arrivent avant la feuille principale, dans leur propre fichier :
    // la politique de sécurité de l'application refuse le style écrit en clair
    expect(html).toMatch(/<link rel="stylesheet" href="\/splash\.css">[\s\S]*main\.css/);
    expect(html).not.toMatch(/<style>/);
  });

  it('a un logo pour chaque thème et une couleur de fond avant la feuille de style', () => {
    expect(html).toContain('splash-logo-dark');
    expect(html).toContain('splash-logo-light');
    expect(css).toContain('.splash-logo-light { display: none; }');
    expect(css).toMatch(/html \{ background: #0d1117; \}/);
    expect(css).toContain('prefers-color-scheme: light');
  });

  it('est retiré par le script principal, et par un filet de sécurité sinon', () => {
    expect(main).toContain('function hideSplash');
    expect(main).toMatch(/\.finally\(\(\) => hideSplash\(\)\)/);
    // Filet : même si le démarrage n'aboutit pas, la page ne reste pas bloquée
    expect(main).toMatch(/getElementById\('splash'\)\?\.remove\(\), 8000\)/);
  });
});
