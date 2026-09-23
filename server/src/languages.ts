import type { DatabaseSync } from 'node:sqlite';

/**
 * Langues ajoutées par l'administration.
 *
 * Une langue est un dictionnaire : chaque texte français de l'application (la
 * clé) reçoit sa traduction. Le catalogue complet des textes est publié avec
 * l'application sous `/i18n/source.json`.
 *
 * Sécurité : ces traductions finissent dans l'interface d'un gestionnaire de
 * mots de passe, là où le coffre est déchiffré. Le serveur, lui, ne doit jamais
 * pouvoir lire ce coffre. Une traduction ne peut donc contenir ni `<`, ni `>`,
 * ni `"` : sans eux, pas de balise et pas de sortie d'attribut, donc pas de
 * script glissé par un serveur malveillant. L'application refait ce tri en
 * chargeant la langue — elle ne fait pas confiance au serveur sur ce point.
 */

/** Code de langue : `es`, `pt-BR`, `zh-Hans`… Le français et l'anglais sont intégrés. */
export const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Z][a-zA-Z]{1,3})?$/;
const BUILT_IN = new Set(['fr', 'en']);

export const MAX_LANGUAGES = 20;
export const MAX_ENTRIES = 5000;
export const MAX_KEY = 600;
export const MAX_VALUE = 1200;
/** Caractères interdits dans une traduction : de quoi sortir du texte */
const DANGEREUX = /[<>"]/;

export interface LanguagePack {
  code: string;
  name: string;
  strings: Record<string, string>;
  updatedAt: number;
}

export interface LanguageSummary {
  code: string;
  name: string;
  count: number;
  updatedAt: number;
}

export class LanguageError extends Error {}

const cleanName = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);

/**
 * Nettoie un dictionnaire reçu. Les entrées douteuses sont écartées une à une
 * plutôt que de refuser tout le fichier : une traduction de 900 textes ne doit
 * pas être perdue pour trois guillemets. Le nombre d'écarts est rendu, pour le
 * dire à l'administration.
 */
export function cleanStrings(input: unknown): { strings: Record<string, string>; rejected: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LanguageError('Le fichier doit associer chaque texte français à sa traduction');
  const strings: Record<string, string> = {};
  let rejected = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(strings).length >= MAX_ENTRIES) { rejected++; continue; }
    if (typeof value !== 'string' || !key.trim() || key.length > MAX_KEY) { rejected++; continue; }
    const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (!text || text.length > MAX_VALUE || DANGEREUX.test(text)) { rejected++; continue; }
    strings[key] = text;
  }
  return { strings, rejected };
}

export function createLanguages(db: DatabaseSync, now: () => number = Date.now) {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?');
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const drop = db.prepare('DELETE FROM settings WHERE key = ?');
  const all = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'i18n.pack.%'");

  const key = (code: string) => `i18n.pack.${code}`;

  const read = (code: string): LanguagePack | null => {
    const row = get.get(key(code)) as { value?: string } | undefined;
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value) as LanguagePack;
      // Relu comme une donnée reçue : une base modifiée à la main ne passe pas outre les règles
      return { code, name: cleanName(parsed.name) || code, strings: cleanStrings(parsed.strings).strings, updatedAt: Number(parsed.updatedAt) || 0 };
    } catch {
      return null;
    }
  };

  return {
    list(): LanguageSummary[] {
      return (all.all() as Array<{ key: string }>)
        .map(row => read(row.key.slice('i18n.pack.'.length)))
        .filter((pack): pack is LanguagePack => !!pack)
        .map(pack => ({ code: pack.code, name: pack.name, count: Object.keys(pack.strings).length, updatedAt: pack.updatedAt }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    get(code: string): LanguagePack | null {
      return LANGUAGE_CODE.test(code) ? read(code) : null;
    },

    save(code: unknown, name: unknown, input: unknown): { pack: LanguageSummary; rejected: number } {
      if (typeof code !== 'string' || !LANGUAGE_CODE.test(code)) throw new LanguageError('Code de langue invalide (ex. : es, pt-BR)');
      if (BUILT_IN.has(code)) throw new LanguageError('Le français et l’anglais sont déjà intégrés à l’application');
      const nom = cleanName(name);
      if (!nom) throw new LanguageError('Donnez un nom à la langue, écrit dans cette langue (ex. : Español)');
      const exists = !!read(code);
      if (!exists && this.list().length >= MAX_LANGUAGES) throw new LanguageError(`${MAX_LANGUAGES} langues au plus`);
      const { strings, rejected } = cleanStrings(input);
      if (Object.keys(strings).length === 0) throw new LanguageError('Aucune traduction utilisable dans ce fichier');
      const pack: LanguagePack = { code, name: nom, strings, updatedAt: now() };
      put.run(key(code), JSON.stringify(pack));
      return { pack: { code, name: nom, count: Object.keys(strings).length, updatedAt: pack.updatedAt }, rejected };
    },

    remove(code: string): boolean {
      if (!LANGUAGE_CODE.test(code) || !read(code)) return false;
      drop.run(key(code));
      return true;
    }
  };
}

export type Languages = ReturnType<typeof createLanguages>;
