import { describe, it, expect } from 'vitest';
import { parsePublicPage, parseServerUrl, publicDirectory, renderLanding, DEFAULT_PUBLIC_PAGE } from '../server/src/directory.ts';
import { parseDirectory } from '../src/ui/serverDirectory';

/** Page publique et annuaire : seules des adresses sûres passent, tout est échappé */

describe('Annuaire de serveurs', () => {
  it('n’accepte que des adresses https (ou locales) sans identifiants', () => {
    expect(parseServerUrl('https://eu.exemple.org/')).toBe('https://eu.exemple.org');
    expect(parseServerUrl('http://localhost:8787')).toBe('http://localhost:8787');
    for (const bad of ['javascript:alert(1)', 'http://exemple.org', 'https://user:pass@exemple.org', 'https://exemple.org/?x=1', 'ftp://exemple.org', '']) {
      expect(parseServerUrl(bad)).toBeNull();
    }
  });

  it('écarte les entrées invalides et borne les textes', () => {
    const page = parsePublicPage({
      directoryEnabled: true,
      servers: [
        { name: 'US', url: 'https://us.exemple.org', region: 'Amérique', official: true },
        { name: 'Piège', url: 'javascript:alert(1)' },
        { name: '', url: 'https://sans-nom.exemple.org' },
        { name: 'N'.repeat(90), url: 'https://long.exemple.org', official: 'oui' }
      ]
    });
    expect(page.servers.map(s => s.url)).toEqual(['https://us.exemple.org', 'https://long.exemple.org']);
    expect(page.servers[1].name).toHaveLength(40);
    expect(page.servers[1].official).toBe(false);
  });

  it('ne publie rien quand l’annuaire est coupé', () => {
    const page = parsePublicPage({ directoryEnabled: false, servers: [{ name: 'US', url: 'https://us.exemple.org' }] });
    expect(publicDirectory(page)).toEqual({ enabled: false, servers: [] });
  });

  it('échappe tout ce que l’hébergeur saisit sur la page publique', () => {
    const page = parsePublicPage({ title: '<script>alert(1)</script>', description: 'Ligne <b>1</b>\n\n<img src=x onerror=alert(1)>', directoryEnabled: true, servers: [{ name: '<i>x</i>', url: 'https://x.exemple.org' }] }, DEFAULT_PUBLIC_PAGE);
    const html = renderLanding({ page, operatorName: '', registrationOpen: true, legalEnabled: false, appAvailable: true, version: '1.0', locale: 'fr' });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<i>x</i>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('côté application, la liste reçue n’est pas crue sur parole', () => {
    expect(parseDirectory({ enabled: false, servers: [{ name: 'a', url: 'https://a.exemple.org' }] })).toEqual([]);
    expect(parseDirectory({ enabled: true, servers: [
      { name: 'Bon', url: 'https://bon.exemple.org', region: 'EU', official: true },
      { name: 'Piège', url: 'javascript:alert(1)' },
      { name: 42, url: 'https://x.exemple.org' }
    ] }).map(s => s.name)).toEqual(['Bon']);
  });
});
