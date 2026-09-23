import { DEFAULT_LINKS, type SiteLinks } from './siteChrome.ts';

/**
 * Liens communautaires des pages publiques, lus dans un fichier JSON hébergé
 * ailleurs (l'adresse se règle dans /admin). Un seul fichier pour plusieurs
 * serveurs : changer l'invitation Discord ne demande pas de toucher à chacun.
 *
 * Format attendu (toutes les clés sont facultatives, seules les adresses
 * https sont gardées) :
 *
 *   {
 *     "discord":   "https://discord.gg/xxxxxxx",
 *     "github":    "https://github.com/FreeProject089/BetterVault",
 *     "status":    "https://status.exemple.org",
 *     "community": "https://bettercommunity.ch",
 *     "downloads": {
 *       "windows": "https://…/BetterVault-setup.exe",
 *       "linux": "https://…/BetterVault.AppImage",
 *       "android": "https://…/BetterVault.apk",
 *       "macos": "https://…",  "ios": "https://…",  "extension": "https://…"
 *     }
 *   }
 *
 * Sans « downloads », Windows, Linux et Android pointent vers la dernière
 * version publiée sur GitHub ; macOS, iOS et l'extension sont « bientôt ».
 *
 * Le fichier est relu au plus une fois par heure. S'il est injoignable ou
 * invalide, les pages gardent les derniers liens connus, sinon les liens par
 * défaut : la page d'accueil ne dépend jamais d'un serveur tiers pour s'afficher.
 */

const TTL_MS = 60 * 60 * 1000;
const MAX_BYTES = 16 * 1024;
const KEYS = ['discord', 'github', 'status', 'community'] as const;
const DOWNLOAD_KEYS = ['windows', 'linux', 'android', 'macos', 'ios', 'extension'] as const;

/** Adresse https sans identifiants, sinon rien */
const safeUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

export function parseSiteLinks(raw: unknown): Partial<SiteLinks> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<SiteLinks> = {};
  for (const key of KEYS) {
    const url = safeUrl((raw as Record<string, unknown>)[key]);
    if (url) out[key] = url;
  }
  // Liens de téléchargement par plateforme (facultatifs, page /telecharger)
  const downloads = (raw as Record<string, unknown>).downloads;
  if (downloads && typeof downloads === 'object') {
    const found: NonNullable<SiteLinks['downloads']> = {};
    for (const key of DOWNLOAD_KEYS) {
      const url = safeUrl((downloads as Record<string, unknown>)[key]);
      if (url) found[key] = url;
    }
    if (Object.keys(found).length) out.downloads = found;
  }
  return out;
}

/**
 * Lit le corps sans jamais en garder plus que `max` octets : l'hôte du fichier
 * est un tiers, un corps géant (ou sans fin) ne doit pas remplir la mémoire.
 */
async function readCapped(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) throw new Error('trop grand');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error('trop grand');
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createSiteLinks(options: { url: () => string; fetchImpl?: typeof fetch; now?: () => number }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cache: { url: string; at: number; links: Partial<SiteLinks> } | null = null;
  let pending: Promise<void> | null = null;

  const refresh = async (url: string) => {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(4000), redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(String(response.status));
      const text = await readCapped(response, MAX_BYTES);
      cache = { url, at: now(), links: parseSiteLinks(JSON.parse(text)) };
    } catch {
      // Injoignable : on garde l'ancien contenu, et on réessaiera plus tard
      cache = { url, at: now(), links: cache?.url === url ? cache.links : {} };
    }
  };

  /** Liens à afficher, sans jamais attendre le réseau plus que la première fois */
  return async (): Promise<SiteLinks> => {
    const url = options.url();
    if (!url) return { ...DEFAULT_LINKS };
    if (!cache || cache.url !== url) {
      pending ??= refresh(url).finally(() => { pending = null; });
      await pending;
    } else if (now() - cache.at > TTL_MS && !pending) {
      pending = refresh(url).finally(() => { pending = null; });
    }
    return { ...DEFAULT_LINKS, ...(cache?.url === url ? cache.links : {}) };
  };
}
