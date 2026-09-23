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
 *     "community": "https://bettercommunity.ch"
 *   }
 *
 * Le fichier est relu au plus une fois par heure. S'il est injoignable ou
 * invalide, les pages gardent les derniers liens connus, sinon les liens par
 * défaut : la page d'accueil ne dépend jamais d'un serveur tiers pour s'afficher.
 */

const TTL_MS = 60 * 60 * 1000;
const MAX_BYTES = 16 * 1024;
const KEYS = ['discord', 'github', 'status', 'community'] as const;

export function parseSiteLinks(raw: unknown): Partial<SiteLinks> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<SiteLinks> = {};
  for (const key of KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'https:' && !url.username && !url.password && value.length <= 300) out[key] = url.href;
    } catch {
      // adresse illisible : ignorée
    }
  }
  return out;
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
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error('trop grand');
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
