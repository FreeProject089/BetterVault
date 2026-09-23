import { describe, it, expect } from 'vitest';
import { renderLanding, renderServersPage, DEFAULT_PUBLIC_PAGE } from '../server/src/directory.ts';

/**
 * Pages publiques : l'accueil et la liste des serveurs. Elles doivent rester
 * compatibles avec leur politique : aucun script, aucune ressource externe, un
 * arrêt des mouvements quand on le demande, et le bon logo selon le thème.
 */

const base = { page: DEFAULT_PUBLIC_PAGE, operatorName: 'Exemple', registrationOpen: true, legalEnabled: true, appAvailable: true, version: '1.1.0', locale: 'fr' as const };
const annuaire = {
  ...DEFAULT_PUBLIC_PAGE,
  directoryEnabled: true,
  servers: [
    { name: 'Coffre Lyon', url: 'https://lyon.exemple.fr', region: 'Europe', official: false },
    { name: 'Officiel UE', url: 'https://eu.exemple.org', region: 'Europe', official: true },
    { name: '"><script>alert(1)</script>', url: 'https://us.exemple.org', region: 'Amérique', official: false }
  ]
};

describe('Page d’accueil', () => {
  it('montre une icône par fonction, dans sa tuile', () => {
    const html = renderLanding(base);
    expect(html.match(/<li><span class="tile tile-md">/g)?.length).toBe(8);
    expect(html).toContain('class="hero-art"');
    expect(html).toContain('class="snake"');
    expect(html).toContain('href="/app">Premiers pas');
  });

  it('mène à l’application sous /app, pas à la racine', () => {
    const html = renderLanding(base);
    expect(html).toContain('href="/app"');
    expect(html).not.toMatch(/class="btn[^"]*" href="\/"/);
  });

  it('ne charge rien d’ailleurs et n’exécute rien', () => {
    const html = renderLanding(base);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|srcset)="https?:\/\//);
    expect(html).not.toMatch(/url\(https?:/);
  });

  it('arrête les animations quand la personne le demande', () => {
    expect(renderLanding(base)).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*animation:none!important/);
  });

  it('sert le logo adapté au thème clair', () => {
    expect(renderLanding(base)).toContain('<source srcset="/admin/logo-on-light.svg" media="(prefers-color-scheme: light)">');
  });

  it('ne propose le lien vers les serveurs que si l’annuaire en contient', () => {
    expect(renderLanding(base)).not.toContain('href="/serveurs"');
    expect(renderLanding({ ...base, page: annuaire })).toContain('href="/serveurs"');
  });
});

describe('Page des serveurs', () => {
  it('n’existe pas quand l’annuaire est coupé ou vide', () => {
    expect(renderServersPage(base)).toBeNull();
  });

  it('regroupe par région, les officiels d’abord, et échappe les noms', () => {
    const html = renderServersPage({ ...base, page: annuaire })!;
    expect(html.indexOf('Officiel UE')).toBeLessThan(html.indexOf('Coffre Lyon'));
    expect(html).toMatch(/Europe[\s\S]*Amérique|Amérique[\s\S]*Europe/);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
