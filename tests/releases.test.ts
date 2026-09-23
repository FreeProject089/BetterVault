import { describe, it, expect } from 'vitest';
import { createReleases, parseRelease, repoOf } from '../server/src/releases.ts';
import { renderDownloadsPage, DEFAULT_PUBLIC_PAGE } from '../server/src/directory.ts';

/**
 * Page Télécharger : chaque plateforme reçoit le fichier de la dernière
 * version publiée, et ce qui n'est pas publié reste « bientôt ».
 */

const asset = (name: string, size = 80 * 1024 ** 2) => ({ name, size, browser_download_url: `https://github.com/o/r/releases/download/v1.2.0/${name}` });
const release = {
  tag_name: 'v1.2.0',
  html_url: 'https://github.com/o/r/releases/tag/v1.2.0',
  draft: false,
  prerelease: false,
  assets: [
    asset('BetterVault_1.2.0_x64_en-US.msi'),
    asset('BetterVault_1.2.0_x64-setup.exe'),
    asset('BetterVault_1.2.0_amd64.AppImage'),
    asset('BetterVault_1.2.0_amd64.deb'),
    asset('BetterVault-1.2.0-1.x86_64.rpm'),
    asset('BetterVault_1.2.0_x64.dmg'),
    asset('BetterVault_1.2.0_aarch64.dmg'),
    asset('BetterVault_aarch64.app.tar.gz'),
    asset('BetterVault_1.2.0_x64-setup.exe.sig'),
    asset('bettervault-android-unsigned.apk'),
    asset('bettervault-extension-v1.2.0.zip', 300 * 1024),
    { name: 'piege.exe', size: 1, browser_download_url: 'https://evil.example/piege-setup.exe' }
  ]
};

describe('Lecture de la dernière version', () => {
  it('choisit le fichier préféré de chaque plateforme, et garde les autres formats', () => {
    const r = parseRelease(release)!;
    expect(r.version).toBe('v1.2.0');
    expect(r.files.windows?.name).toBe('BetterVault_1.2.0_x64-setup.exe');
    expect(r.others.windows?.map(f => f.name)).toEqual(['BetterVault_1.2.0_x64_en-US.msi']);
    expect(r.files.linux?.name).toMatch(/AppImage$/);
    expect(r.others.linux?.map(f => f.name.split('.').pop())).toEqual(['deb', 'rpm']);
    expect(r.files.macos).toMatchObject({ name: 'BetterVault_1.2.0_aarch64.dmg', note: 'Apple Silicon' });
    expect(r.others.macos?.[0]).toMatchObject({ note: 'Intel' });
    expect(r.files.android).toBeUndefined();
    expect(r.files.extension?.name).toBe('bettervault-extension-v1.2.0.zip');
    expect(r.files.ios).toBeUndefined();
  });

  it('ignore les archives de mise à jour et les adresses hors de GitHub', () => {
    const names = Object.values(parseRelease(release)!.files).map(f => f!.name).join(' ');
    expect(names).not.toMatch(/tar\.gz|\.sig|piege/);
  });

  it('ne propose jamais un APK non signé, qu’Android refuserait d’installer', () => {
    const r = parseRelease({ ...release, assets: [asset('bettervault-android-unsigned.apk'), asset('bettervault-android.apk')] })!;
    expect(r.files.android?.name).toBe('bettervault-android.apk');
    expect(r.others.android).toBeUndefined();
    const html = renderDownloadsPage({ page: DEFAULT_PUBLIC_PAGE, operatorName: 'X', registrationOpen: true, legalEnabled: true, appAvailable: true, version: '1', locale: 'fr', release: parseRelease(release) });
    expect(html).toMatch(/class="dl-card soon" data-platform="android"/);
    expect(html).not.toContain('unsigned');
  });

  it('refuse les brouillons et les préversions', () => {
    expect(parseRelease({ ...release, draft: true })).toBeNull();
    expect(parseRelease({ ...release, prerelease: true })).toBeNull();
  });

  it('ne reconnaît que les dépôts github.com', () => {
    expect(repoOf('https://github.com/FreeProject089/BetterVault')).toBe('FreeProject089/BetterVault');
    expect(repoOf('https://github.com/a/b.git/')).toBe('a/b');
    expect(repoOf('https://gitlab.com/a/b')).toBeNull();
    expect(repoOf('https://github.com/a/b/../../x')).toBeNull();
  });

  it('distingue « aucune version » de « GitHub injoignable », et garde la dernière connue', async () => {
    let clock = 0;
    let reply: () => Response = () => new Response('{}', { status: 404 });
    const calls: string[] = [];
    const latest = createReleases({
      repoUrl: () => 'https://github.com/o/r',
      now: () => clock,
      fetchImpl: (async (url: string) => { calls.push(url); return reply(); }) as typeof fetch
    });
    expect(await latest()).toBeNull();
    expect(calls).toEqual(['https://api.github.com/repos/o/r/releases/latest']);

    reply = () => new Response(JSON.stringify(release));
    clock += 2 * 60 * 60 * 1000;
    await latest(); // relance en arrière-plan
    await new Promise(r => setTimeout(r, 0));
    expect((await latest())?.version).toBe('v1.2.0');

    reply = () => { throw new Error('hors ligne'); };
    clock += 2 * 60 * 60 * 1000;
    await latest();
    await new Promise(r => setTimeout(r, 0));
    expect((await latest())?.version).toBe('v1.2.0');
  });

  it('ne sait rien quand GitHub n’a jamais répondu', async () => {
    const latest = createReleases({ repoUrl: () => 'https://github.com/o/r', fetchImpl: (async () => { throw new Error('x'); }) as typeof fetch });
    expect(await latest()).toBeUndefined();
  });
});

describe('Page Télécharger avec une version publiée', () => {
  const base = { page: DEFAULT_PUBLIC_PAGE, operatorName: 'Exemple', registrationOpen: true, legalEnabled: true, appAvailable: true, version: '1.1.0', locale: 'fr' as const };

  it('relie chaque bouton à son fichier, avec version et taille', () => {
    const html = renderDownloadsPage({ ...base, release: parseRelease(release) });
    expect(html).toContain('href="https://github.com/o/r/releases/download/v1.2.0/BetterVault_1.2.0_x64-setup.exe"');
    expect(html).toContain('v1.2.0 · 80 Mo');
    expect(html).toContain('v1.2.0 · 80 Mo · Aussi : <a href="https://github.com/o/r/releases/download/v1.2.0/BetterVault_1.2.0_amd64.deb" rel="noopener">.deb</a>, <a');
    expect(html).toContain('v1.2.0 · 300 Ko');
    // macOS et l'extension sont publiés : plus « bientôt » ; iOS l'est toujours
    expect(html).toMatch(/class="dl-card" data-platform="macos"/);
    expect(html).toMatch(/class="dl-card" data-platform="extension"/);
    expect(html).toMatch(/class="dl-card soon" data-platform="ios"/);
  });

  it('marque tout « bientôt » quand aucune version n’est publiée', () => {
    const html = renderDownloadsPage({ ...base, release: null });
    expect(html.match(/class="dl-card soon"/g)?.length).toBe(6);
    expect(html).not.toContain('/releases/latest');
  });

  it('laisse le lien de l’hébergeur passer avant GitHub', () => {
    const html = renderDownloadsPage({ ...base, release: parseRelease(release), links: { github: 'https://github.com/o/r', community: 'https://bettercommunity.ch', downloads: { windows: 'https://exemple.org/setup.exe' } } });
    expect(html).toContain('href="https://exemple.org/setup.exe"');
    expect(html).not.toContain('x64-setup.exe"');
  });
});
