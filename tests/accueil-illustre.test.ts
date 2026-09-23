import { describe, it, expect } from 'vitest';
import { renderLanding, DEFAULT_PUBLIC_PAGE } from '../server/src/directory.ts';

/**
 * Page d'accueil, avec et sans illustrations. La version illustrée doit rester
 * compatible avec la politique de la page : aucun script, aucune ressource
 * externe, et un arrêt des mouvements quand on le demande.
 */

const base = { page: DEFAULT_PUBLIC_PAGE, operatorName: 'Exemple', registrationOpen: true, legalEnabled: true, appAvailable: true, version: '1.1.0', locale: 'fr' as const };

describe('Page d’accueil illustrée', () => {
  it('reste sobre par défaut', () => {
    const html = renderLanding(base);
    expect(html).not.toContain('class="iso"');
    expect(html).not.toContain('hero-art');
  });

  it('ajoute une icône par fonction, le coffre et le schéma du trajet', () => {
    const html = renderLanding({ ...base, variant: 'illustre' });
    expect(html.match(/<li><svg class="iso"/g)?.length).toBe(8);
    expect(html).toContain('class="hero-art"');
    expect(html).toContain('class="flow"');
  });

  it('ne charge rien d’ailleurs et n’exécute rien', () => {
    const html = renderLanding({ ...base, variant: 'illustre' });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)="https?:\/\/(?!www\.w3\.org)/);
    expect(html).not.toMatch(/url\(https?:/);
  });

  it('arrête les animations quand la personne le demande', () => {
    const html = renderLanding({ ...base, variant: 'illustre' });
    expect(html).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*animation:none!important/);
  });

  it('donne un nom accessible aux illustrations qui portent un sens', () => {
    const html = renderLanding({ ...base, variant: 'illustre' });
    expect(html).toMatch(/class="hero-art" role="img" aria-label="[^"]+"/);
    expect(html).toMatch(/class="flow" role="img" aria-label="[^"]+ → [^"]+ → [^"]+"/);
  });
});
