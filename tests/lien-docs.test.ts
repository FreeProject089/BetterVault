// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Lien « En savoir plus » : il construit une adresse à partir du serveur du
 * compte. Cette adresse finit dans un attribut href : rien de ce qui vient du
 * compte ne doit pouvoir en sortir, et aucun lien mort ne doit s''afficher.
 */

const compte: { serverUrl?: string } | null = { serverUrl: undefined };
vi.mock('../src/app/services', () => ({
  accountService: { getAccount: () => compte }
}));

const { docsUrl, learnMore } = await import('../src/ui/docsLink');
const tr = (fr: string) => fr;

beforeEach(() => { compte!.serverUrl = undefined; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('Lien vers la documentation', () => {
  it('pointe vers la documentation du serveur du compte', () => {
    compte!.serverUrl = 'https://coffre.exemple.fr';
    expect(docsUrl('guide/premiers-pas')).toBe('https://coffre.exemple.fr/docs/guide/premiers-pas');
    compte!.serverUrl = 'https://coffre.exemple.fr/';
    expect(docsUrl('index')).toBe('https://coffre.exemple.fr/docs/index');
  });

  it('n’accepte que des noms de page connus', () => {
    compte!.serverUrl = 'https://coffre.exemple.fr';
    for (const page of ['../../etc/passwd', 'guide/../secret', 'Guide/Majuscule', 'guide/trop/profond', 'page?x=1', 'page"onmouseover=1']) {
      expect(docsUrl(page), page).toBeNull();
    }
  });

  it('n’affiche pas de lien quand il n’y a pas de documentation joignable', () => {
    // Application de bureau : la webview sert du http mais n’embarque pas /docs
    vi.stubGlobal('location', { protocol: 'http:', hostname: 'tauri.localhost' });
    expect(docsUrl('index')).toBeNull();
    expect(learnMore('index', tr)).toBe('');

    vi.stubGlobal('location', { protocol: 'chrome-extension:', hostname: 'abcdefg' });
    expect(docsUrl('index')).toBeNull();
  });

  it('utilise le chemin relatif quand l’application est servie par un serveur', () => {
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'coffre.exemple.fr' });
    expect(docsUrl('guide/apparence')).toBe('/docs/guide/apparence');
  });

  it('produit un lien sûr, ouvert sans referrer', () => {
    compte!.serverUrl = 'https://coffre.exemple.fr';
    const html = learnMore('index', tr);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    // Le lien est inséré dans du HTML : l’adresse ne doit contenir ni guillemet ni chevron
    const adresse = /href="([^"]*)"/.exec(html)![1];
    expect(adresse).toBe('https://coffre.exemple.fr/docs/index');
    expect(adresse).not.toMatch(/["'<>\s]/);
  });
});
