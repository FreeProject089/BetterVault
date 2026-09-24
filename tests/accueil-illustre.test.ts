import { describe, it, expect } from 'vitest';
import { renderDownloadsPage, renderLanding, renderPlansPage, renderServersPage, DEFAULT_PUBLIC_PAGE } from '../server/src/directory.ts';
import { parseSiteLinks } from '../server/src/siteLinks.ts';

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
    // Chaque casier du coffre est un lien vers la page de documentation de la fonction
    expect(html.match(/<a class="locker" href="\/docs\/[a-z/-]+"><span class="tile tile-md">/g)?.length).toBe(8);
    expect(html).toContain('data-vault');
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
    // Un seul script, servi par le serveur lui-même ; aucun script en ligne
    expect(html.match(/<script[^>]*>/gi)).toEqual([expect.stringMatching(/^<script src="\/site\.js\?v=[0-9a-f]{10}" defer>$/)]);
    expect(html).not.toMatch(/<script>[^<]/i);
    expect(html).not.toMatch(/(src|srcset)="https?:\/\//);
    expect(html).not.toMatch(/url\(https?:/);
  });

  it('arrête les animations quand la personne le demande', () => {
    expect(renderLanding(base)).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*animation:none!important/);
  });

  it('sert le logo adapté au thème clair', () => {
    expect(renderLanding(base)).toContain('<img class="logo-l" src="/admin/logo-on-light.svg"');
  });

  it('propose un bouton de thème, et applique le thème choisi dès le rendu', () => {
    const html = renderLanding({ ...base, path: '/download' });
    expect(html).toContain('href="/theme?set=light&amp;back=%2Fdownload"');
    expect(html).toContain('<html lang="fr">');
    // Le choix l'emporte sur le système, dans les deux sens
    expect(renderLanding({ ...base, theme: 'light' })).toContain('<html lang="fr" data-theme="light">');
    expect(html).toMatch(/@media \(prefers-color-scheme:light\)\{:root:not\(\[data-theme=dark\]\)\{--bg:#f6f8fa/);
    expect(html).toContain(':root[data-theme=light]{--bg:#f6f8fa');
  });

  it('ne propose le lien vers les serveurs que si l’annuaire en contient', () => {
    expect(renderLanding(base)).not.toContain('href="/servers"');
    expect(renderLanding({ ...base, page: annuaire })).toContain('href="/servers"');
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

describe('Page des tarifs et liens', () => {
  const plan = { id: 'plus', name: 'Plus', description: 'Plus d’espace', boosts: { attachmentQuotaBytes: 10 * 1024 ** 3 },
    prices: [{ label: '2 € / mois', amount: 200, currency: 'eur', interval: 'month' as const }, { label: '20 € / an', amount: 2000, currency: 'eur', interval: 'year' as const }] };

  it('n’existe pas sans offre publiée', () => {
    expect(renderPlansPage(base)).toBeNull();
  });

  it('montre les offres, la bascule mensuel / annuel et l’offre gratuite', () => {
    const html = renderPlansPage({ ...base, plans: [plan], freeLimits: { maxVaults: 10, maxCredentialsPerVault: 500, attachmentQuotaBytes: 500 * 1024 ** 2 } })!;
    expect(html).toContain('id="per-year"');
    expect(html).toContain('<span class="amount">20</span>');
    expect(html).toContain('<span class="amount">2</span>');
    expect(html).toContain('10 Go');
    expect(html).toContain('Gratuit');
  });

  it('propose le lien Discord seulement quand il est connu, et le code source toujours', () => {
    expect(renderLanding(base)).not.toContain('discord.gg');
    expect(renderLanding(base)).toContain('https://github.com/FreeProject089/BetterVault');
    const html = renderLanding({ ...base, links: { github: 'https://github.com/x/y', community: 'https://bettercommunity.ch', discord: 'https://discord.gg/abc' } });
    expect(html).toContain('href="https://discord.gg/abc"');
  });

  it('bascule entre deux langues par un lien, sans menu', () => {
    const html = renderLanding({ ...base, path: '/' });
    expect(html).toContain('href="/?lang=en"');
    expect(html).not.toContain('class="lang-menu');
  });

  it('ne garde des liens externes que les adresses https', () => {
    expect(parseSiteLinks({ discord: 'javascript:alert(1)', status: 'http://x.org', github: 'https://github.com/a/b' })).toEqual({ github: 'https://github.com/a/b' });
  });
});

describe('Langues des pages publiques', () => {
  const langs = [{ code: 'fr', label: 'Français' }, { code: 'en', label: 'English' }, { code: 'de', label: 'Deutsch' }];

  it('traduit par le pack quand il connaît le texte, sinon affiche l’anglais', () => {
    const html = renderLanding({ ...base, locale: 'en', lang: 'de', strings: { 'Premiers pas': 'Erste Schritte' }, langs, path: '/' });
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('Erste Schritte');
    expect(html).toContain('How it works');
    expect(html).not.toContain('Comment ça marche');
  });

  it('passe en menu déroulant au-delà de deux langues', () => {
    const html = renderLanding({ ...base, langs, path: '/' });
    expect(html).toContain('class="lang-menu lang-bar"');
    expect(html).toContain('href="/?lang=de"');
    expect(html).not.toContain('class="lang-toggle');
  });

  it('échappe le nom d’une langue venu de l’administration', () => {
    const html = renderLanding({ ...base, langs: [...langs, { code: 'xx', label: '<b>x</b>' }], path: '/' });
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('Page des téléchargements', () => {
  it('propose Windows, Linux et Android, et marque le reste « bientôt »', () => {
    const html = renderDownloadsPage(base);
    expect(html).toContain('href="https://github.com/FreeProject089/BetterVault/releases/latest"');
    for (const k of ['windows', 'linux', 'android']) expect(html).toMatch(new RegExp(`class="dl-card" data-platform="${k}"`));
    for (const k of ['macos', 'ios', 'extension']) expect(html).toMatch(new RegExp(`class="dl-card soon" data-platform="${k}"`));
    // L'application web s'installe depuis la page : manifeste et bouton
    expect(html).toContain('<link rel="manifest" href="/manifest.json">');
    expect(html).toContain('data-install');
  });

  it('prend les liens publiés par l’hébergeur, et rend disponible ce qu’il publie', () => {
    const html = renderDownloadsPage({ ...base, links: { github: 'https://github.com/x/y', community: 'https://bettercommunity.ch', downloads: { macos: 'https://exemple.org/BetterVault.dmg', windows: 'https://exemple.org/setup.exe' } } });
    expect(html).toContain('href="https://exemple.org/BetterVault.dmg"');
    expect(html).toContain('href="https://exemple.org/setup.exe"');
    expect(html).toMatch(/class="dl-card" data-platform="macos"/);
  });

  it('ne garde des liens de téléchargement que les adresses https', () => {
    expect(parseSiteLinks({ downloads: { windows: 'javascript:alert(1)', linux: 'http://x.org/a', android: 'https://x.org/a.apk' } })).toEqual({ downloads: { android: 'https://x.org/a.apk' } });
  });

  it('apparaît dans la barre du haut', () => {
    expect(renderLanding(base)).toContain('href="/download"');
  });
});
