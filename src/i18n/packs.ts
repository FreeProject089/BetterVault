/**
 * Langues ajoutées par le serveur, en plus du français et de l'anglais.
 *
 * Une langue est un dictionnaire : texte français → traduction. Tout texte
 * absent retombe sur l'anglais, qui reste complet.
 *
 * Le serveur n'est pas cru sur parole : il ne doit jamais pouvoir lire le
 * coffre, et ces textes s'affichent là où le coffre est déchiffré. Chaque
 * traduction contenant `<`, `>` ou `"` est donc écartée ici aussi — sans ces
 * caractères, un texte ne peut ni ouvrir une balise ni sortir d'un attribut.
 */

export interface LanguageInfo {
  code: string;
  name: string;
}

export interface LanguagePack extends LanguageInfo {
  strings: Record<string, string>;
}

const CODE = /^[a-z]{2,3}(?:-[A-Z][a-zA-Z]{1,3})?$/;
const DANGEREUX = /[<>"]/;
const MAX_ENTRIES = 5000;
const CACHE_PREFIX = 'bettervault.i18n.pack.';
const LIST_KEY = 'bettervault.i18n.list';

export const isLanguageCode = (value: unknown): value is string => typeof value === 'string' && CODE.test(value) && value !== 'fr' && value !== 'en';

/** Nom affichable : court, sans balisage */
const cleanName = (value: unknown, fallback: string) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f<>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || fallback;

/** Relit un dictionnaire reçu en ne gardant que du texte sûr */
export function sanitizePack(input: unknown): LanguagePack | null {
  const raw = input as { code?: unknown; name?: unknown; strings?: unknown } | null;
  if (!raw || typeof raw !== 'object' || !isLanguageCode(raw.code)) return null;
  const source = raw.strings && typeof raw.strings === 'object' && !Array.isArray(raw.strings) ? raw.strings as Record<string, unknown> : {};
  const strings: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(source)) {
    if (count >= MAX_ENTRIES) break;
    if (typeof value !== 'string' || !value.trim() || DANGEREUX.test(value)) continue;
    strings[key] = value;
    count++;
  }
  return { code: raw.code, name: cleanName(raw.name, raw.code), strings };
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible : la langue vaut pour cette session
  }
};

/** Dernière liste connue : le sélecteur s'affiche sans attendre le réseau */
export function cachedLanguages(): LanguageInfo[] {
  try {
    const list = JSON.parse(read(LIST_KEY) ?? '[]') as unknown[];
    return list.flatMap(item => {
      const l = item as { code?: unknown; name?: unknown };
      return isLanguageCode(l.code) ? [{ code: l.code, name: cleanName(l.name, l.code) }] : [];
    });
  } catch {
    return [];
  }
}

/** Dictionnaire gardé sur l'appareil : la langue choisie marche dès l'ouverture, même hors ligne */
export function cachedPack(code: string): LanguagePack | null {
  if (!isLanguageCode(code)) return null;
  try {
    return sanitizePack(JSON.parse(read(CACHE_PREFIX + code) ?? 'null'));
  } catch {
    return null;
  }
}

/** Adresse du serveur à interroger, ou null s'il n'y en a pas */
export type ServerBase = string | null;

export async function fetchLanguages(base: ServerBase): Promise<LanguageInfo[]> {
  if (base === null) return cachedLanguages();
  const response = await fetch(`${base}/api/v1/i18n`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { languages?: unknown[] };
  const list = (body.languages ?? []).flatMap(item => {
    const l = item as { code?: unknown; name?: unknown };
    return isLanguageCode(l.code) ? [{ code: l.code, name: cleanName(l.name, l.code) }] : [];
  });
  write(LIST_KEY, JSON.stringify(list));
  return list;
}

export async function fetchPack(base: ServerBase, code: string): Promise<LanguagePack | null> {
  if (!isLanguageCode(code)) return null;
  if (base === null) return cachedPack(code);
  const response = await fetch(`${base}/api/v1/i18n/${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const pack = sanitizePack(await response.json());
  if (pack) write(CACHE_PREFIX + code, JSON.stringify(pack));
  return pack;
}

export function forgetPack(code: string): void {
  if (isLanguageCode(code)) write(CACHE_PREFIX + code, null);
}
