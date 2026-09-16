import type { CredentialItem } from '../types/vault';

/**
 * Exports vers d'autres gestionnaires de mots de passe, au format que chacun accepte à l'import.
 * Tous ces fichiers sont en clair : l'interface demande confirmation avant de les créer.
 */

export type ManagerExportId = 'bitwarden-json' | '1password' | 'lastpass' | 'proton' | 'dashlane' | 'chrome' | 'firefox' | 'apple' | 'keepassxc-csv' | 'passky';

export interface ManagerExport {
  id: ManagerExportId;
  name: string;
  /** Slug Simple Icons pour le logo */
  logo: string;
  extension: 'csv' | 'json';
  build(credentials: CredentialItem[]): string;
}

const cell = (value: unknown) => {
  const text = value === undefined || value === null ? '' : String(value);
  // Formules neutralisées : un tableur ne doit pas exécuter un champ commençant par = + - @
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) || safe !== text ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const csv = (headers: string[], rows: unknown[][]) =>
  [headers.map(cell).join(','), ...rows.map(row => row.map(cell).join(','))].join('\r\n') + '\r\n';

/** Adresse avec schéma : les navigateurs ignorent les lignes sans https:// */
const withScheme = (url: string) => (!url ? '' : /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);

const otpUri = (c: CredentialItem) => {
  const secret = c.totpSecret?.trim();
  if (!secret) return '';
  if (secret.startsWith('otpauth://')) return secret;
  const label = encodeURIComponent(c.username ? `${c.title}:${c.username}` : c.title);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret.replace(/\s/g, ''))}&issuer=${encodeURIComponent(c.title)}`;
};

/** Notes, plus les champs personnalisés en texte pour les formats qui n'en ont pas */
const notesWithFields = (c: CredentialItem) => {
  const fields = (c.fields ?? []).map(f => `${f.label}: ${f.value}`);
  return [c.notes ?? '', ...fields].filter(Boolean).join('\n');
};

const iso = (ms: number | undefined) => (ms ? new Date(ms).toISOString() : new Date().toISOString());

export const MANAGER_EXPORTS: ManagerExport[] = [
  {
    id: 'bitwarden-json',
    name: 'Bitwarden (JSON)',
    logo: 'bitwarden',
    extension: 'json',
    build: credentials => JSON.stringify({
      encrypted: false,
      folders: [],
      items: credentials.map(c => ({
        id: c.id,
        folderId: null,
        type: 1,
        reprompt: 0,
        name: c.title,
        notes: c.notes || null,
        favorite: !!c.isFavorite,
        fields: (c.fields ?? []).map(f => ({ name: f.label, value: f.value, type: f.isMasked ? 1 : 0, linkedId: null })),
        login: {
          uris: c.website ? [{ match: null, uri: withScheme(c.website) }] : [],
          username: c.username || null,
          password: c.password || null,
          totp: c.totpSecret || null
        },
        collectionIds: null,
        creationDate: iso(c.createdAt),
        revisionDate: iso(c.updatedAt)
      }))
    }, null, 2)
  },
  {
    id: '1password',
    name: '1Password (CSV)',
    logo: '1password',
    extension: 'csv',
    build: credentials => csv(
      ['Title', 'Website', 'Username', 'Password', 'OTPAuth', 'Favorite', 'Tags', 'Notes'],
      credentials.map(c => [c.title, withScheme(c.website), c.username, c.password, otpUri(c), c.isFavorite ? 'true' : 'false', (c.tags ?? []).join(';'), notesWithFields(c)])
    )
  },
  {
    id: 'lastpass',
    name: 'LastPass (CSV)',
    logo: 'lastpass',
    extension: 'csv',
    build: credentials => csv(
      ['url', 'username', 'password', 'totp', 'extra', 'name', 'grouping', 'fav'],
      credentials.map(c => [withScheme(c.website) || 'http://sn', c.username, c.password, c.totpSecret ?? '', notesWithFields(c), c.title, (c.tags ?? [])[0] ?? '', c.isFavorite ? '1' : '0'])
    )
  },
  {
    id: 'proton',
    name: 'Proton Pass (CSV)',
    logo: 'proton',
    extension: 'csv',
    build: credentials => csv(
      ['type', 'name', 'url', 'email', 'username', 'password', 'note', 'totp', 'createTime', 'modifyTime', 'vault'],
      credentials.map(c => {
        const isEmail = /@/.test(c.username ?? '');
        return ['login', c.title, withScheme(c.website), isEmail ? c.username : '', isEmail ? '' : c.username, c.password, notesWithFields(c), otpUri(c),
          Math.floor((c.createdAt ?? Date.now()) / 1000), Math.floor((c.updatedAt ?? Date.now()) / 1000), 'BetterVault'];
      })
    )
  },
  {
    id: 'dashlane',
    name: 'Dashlane (CSV)',
    logo: 'dashlane',
    extension: 'csv',
    build: credentials => csv(
      ['username', 'username2', 'username3', 'title', 'password', 'note', 'url', 'category', 'otpSecret'],
      credentials.map(c => [c.username, '', '', c.title, c.password, notesWithFields(c), withScheme(c.website), (c.tags ?? [])[0] ?? '', c.totpSecret ?? ''])
    )
  },
  {
    id: 'chrome',
    name: 'Chrome, Edge, Brave (CSV)',
    logo: 'googlechrome',
    extension: 'csv',
    build: credentials => csv(
      ['name', 'url', 'username', 'password', 'note'],
      credentials.filter(c => c.website).map(c => [c.title, withScheme(c.website), c.username, c.password, c.notes ?? ''])
    )
  },
  {
    id: 'firefox',
    name: 'Firefox (CSV)',
    logo: 'firefoxbrowser',
    extension: 'csv',
    build: credentials => csv(
      ['url', 'username', 'password', 'httpRealm', 'formActionOrigin', 'guid', 'timeCreated', 'timeLastUsed', 'timePasswordChanged'],
      credentials.filter(c => c.website).map(c => {
        const url = withScheme(c.website);
        let origin = url;
        try { origin = new URL(url).origin; } catch { /* adresse laissée telle quelle */ }
        return [origin, c.username, c.password, '', origin, `{${c.id}}`, c.createdAt ?? '', c.updatedAt ?? '', c.updatedAt ?? ''];
      })
    )
  },
  {
    id: 'apple',
    name: 'Mots de passe Apple (CSV)',
    logo: 'apple',
    extension: 'csv',
    build: credentials => csv(
      ['Title', 'URL', 'Username', 'Password', 'Notes', 'OTPAuth'],
      credentials.map(c => [c.title, withScheme(c.website), c.username, c.password, notesWithFields(c), otpUri(c)])
    )
  },
  {
    id: 'keepassxc-csv',
    name: 'KeePassXC (CSV)',
    logo: 'keepassxc',
    extension: 'csv',
    build: credentials => csv(
      ['Group', 'Title', 'Username', 'Password', 'URL', 'Notes', 'TOTP', 'Icon', 'Last Modified', 'Created'],
      credentials.map(c => [(c.tags ?? [])[0] ?? 'BetterVault', c.title, c.username, c.password, withScheme(c.website), notesWithFields(c), otpUri(c), '0', iso(c.updatedAt), iso(c.createdAt)])
    )
  },
  {
    id: 'passky',
    name: 'Passky (JSON)',
    logo: '',
    extension: 'json',
    build: credentials => JSON.stringify({
      encrypted: false,
      passwords: credentials.map(c => ({ website: c.website || c.title, username: c.username ?? '', password: c.password ?? '', message: notesWithFields(c) }))
    }, null, 2)
  }
];
