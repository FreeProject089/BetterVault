import { readCapped } from './siteLinks.ts';

/**
 * Dernière version publiée sur GitHub, pour la page Télécharger : chaque
 * plateforme y trouve son fichier (installeur Windows, AppImage, APK…), avec
 * son numéro de version et sa taille. Une plateforme sans fichier dans la
 * version est marquée « bientôt » ; rien n'est annoncé qui n'existe pas.
 *
 * La version est relue au plus une fois par heure, et seulement quand quelqu'un
 * ouvre la page. La requête ne porte aucune donnée de compte. Si GitHub ne
 * répond pas, la page garde la dernière version connue, sinon elle renvoie à
 * la page des versions : elle ne dépend jamais de GitHub pour s'afficher.
 */

export type Platform = 'windows' | 'linux' | 'android' | 'macos' | 'ios' | 'extension';

export interface ReleaseFile {
  url: string;
  name: string;
  size: number;
  /** Précision affichée à côté du bouton (« Apple Silicon », « Intel ») */
  note?: string;
}

export interface ReleaseInfo {
  version: string;
  page: string;
  /** Fichier principal par plateforme, puis les autres formats proposés */
  files: Partial<Record<Platform, ReleaseFile>>;
  others: Partial<Record<Platform, ReleaseFile[]>>;
}

const TTL_MS = 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024;

/** Adresse de téléchargement GitHub, et seulement elle */
const githubUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com')) ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * Formats reconnus, du préféré au moins préféré. Les archives de mise à jour
 * (.app.tar.gz, .sig, .nsis.zip…) ne sont pas des installeurs : ignorées.
 */
const RULES: Array<{ platform: Platform; test: RegExp; note?: string }> = [
  { platform: 'windows', test: /-setup\.exe$/i },
  { platform: 'windows', test: /\.msi$/i },
  { platform: 'linux', test: /\.AppImage$/i },
  { platform: 'linux', test: /\.deb$/i },
  { platform: 'linux', test: /\.rpm$/i },
  { platform: 'macos', test: /(aarch64|arm64).*\.dmg$/i, note: 'Apple Silicon' },
  { platform: 'macos', test: /(x64|x86_64|intel).*\.dmg$/i, note: 'Intel' },
  { platform: 'macos', test: /\.dmg$/i },
  { platform: 'android', test: /\.apk$/i },
  { platform: 'ios', test: /\.ipa$/i },
  { platform: 'extension', test: /extension.*\.zip$/i }
];

export function parseRelease(raw: unknown): ReleaseInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const release = raw as Record<string, unknown>;
  if (release.draft || release.prerelease) return null;
  const version = typeof release.tag_name === 'string' ? release.tag_name.slice(0, 40) : '';
  const page = githubUrl(release.html_url);
  if (!version || !page) return null;

  const found = new Map<Platform, Array<ReleaseFile & { rank: number }>>();
  for (const asset of Array.isArray(release.assets) ? release.assets.slice(0, 100) : []) {
    const a = asset as Record<string, unknown>;
    const name = typeof a.name === 'string' ? a.name.slice(0, 160) : '';
    const url = githubUrl(a.browser_download_url);
    if (!name || !url) continue;
    // Android refuse d'installer un APK non signé : ce n'est pas un téléchargement
    if (/unsigned/i.test(name)) continue;
    const rank = RULES.findIndex(rule => rule.test.test(name));
    if (rank < 0) continue;
    const { platform, note } = RULES[rank];
    const list = found.get(platform) ?? [];
    if (list.some(f => f.name === name)) continue;
    list.push({ url, name, size: typeof a.size === 'number' ? a.size : 0, ...(note ? { note } : {}), rank });
    found.set(platform, list);
  }

  const files: ReleaseInfo['files'] = {};
  const others: ReleaseInfo['others'] = {};
  for (const [platform, list] of found) {
    const [first, ...rest] = list.sort((a, b) => a.rank - b.rank).map(({ rank: _, ...file }) => file);
    files[platform] = first;
    if (rest.length) others[platform] = rest;
  }
  return { version, page, files, others };
}

/** « owner/dépôt » d'une adresse github.com, sinon rien */
export function repoOf(url: string): string | null {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export function createReleases(options: { repoUrl: () => string; fetchImpl?: typeof fetch; now?: () => number }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cache: { repo: string; at: number; release: ReleaseInfo | null; known: boolean } | null = null;
  let pending: Promise<void> | null = null;

  const refresh = async (repo: string) => {
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
        signal: AbortSignal.timeout(4000),
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BetterVault' }
      });
      // 404 : aucune version publiée (les brouillons ne comptent pas)
      if (response.status === 404) { cache = { repo, at: now(), release: null, known: true }; return; }
      if (!response.ok) throw new Error(String(response.status));
      cache = { repo, at: now(), release: parseRelease(JSON.parse(await readCapped(response, MAX_BYTES))), known: true };
    } catch {
      // Injoignable : on garde ce qu'on savait, et on réessaiera plus tard
      const same = cache?.repo === repo ? cache : null;
      cache = { repo, at: now(), release: same?.release ?? null, known: same?.known ?? false };
    }
  };

  /**
   * La version publiée, `null` s'il n'y en a aucune, `undefined` si on ne sait
   * pas (GitHub injoignable, dépôt ailleurs que sur github.com).
   */
  return async (): Promise<ReleaseInfo | null | undefined> => {
    const repo = repoOf(options.repoUrl());
    if (!repo) return undefined;
    if (!cache || cache.repo !== repo) {
      pending ??= refresh(repo).finally(() => { pending = null; });
      await pending;
    } else if (now() - cache.at > TTL_MS && !pending) {
      pending = refresh(repo).finally(() => { pending = null; });
    }
    return cache?.repo === repo && cache.known ? cache.release : undefined;
  };
}
