import type { CredentialItem } from '../types/vault';
import { calculatePasswordEntropy } from '../crypto/vaultCrypto';
import { EXPIRY_SOON_DAYS } from '../ui/expiry';

export type CredentialFilter = 'favorites' | 'totp' | 'passkeys' | 'expiring' | 'expired' | 'weak' | 'reused' | 'noPassword';
export type CredentialSort = 'name' | 'recent' | 'updated' | 'expiry';

export const CREDENTIAL_FILTERS: CredentialFilter[] = ['favorites', 'totp', 'passkeys', 'expiring', 'expired', 'weak', 'reused', 'noPassword'];

export interface CredentialQuery {
  search?: string;
  filters?: ReadonlySet<CredentialFilter>;
  sort?: CredentialSort;
  tag?: string | null;
}

const DAY_MS = 86_400_000;

/** Mots de passe utilisés par plusieurs identifiants de la liste */
export function reusedPasswords(credentials: CredentialItem[]): Set<string> {
  const seen = new Map<string, number>();
  for (const c of credentials) if (c.password) seen.set(c.password, (seen.get(c.password) ?? 0) + 1);
  return new Set([...seen].filter(([, count]) => count > 1).map(([password]) => password));
}

export function matchesFilter(c: CredentialItem, filter: CredentialFilter, reused: Set<string>, now: number): boolean {
  switch (filter) {
    case 'favorites': return !!c.isFavorite;
    case 'totp': return !!c.totpSecret;
    case 'passkeys': return (c.passkeys?.length ?? 0) > 0;
    case 'expired': return !!c.expiresAt && c.expiresAt < now;
    case 'expiring': return !!c.expiresAt && c.expiresAt >= now && c.expiresAt - now <= EXPIRY_SOON_DAYS * DAY_MS;
    case 'weak': return !!c.password && calculatePasswordEntropy(c.password).score <= 2;
    case 'reused': return !!c.password && reused.has(c.password);
    case 'noPassword': return !c.password;
  }
}

/** Filtres cumulés (ET), recherche plein texte et tri */
export function queryCredentials(credentials: CredentialItem[], query: CredentialQuery, now = Date.now()): CredentialItem[] {
  const search = query.search?.trim().toLowerCase() ?? '';
  const tag = query.tag?.toLowerCase();
  const filters = query.filters ?? new Set<CredentialFilter>();
  const reused = filters.has('reused') ? reusedPasswords(credentials) : new Set<string>();

  const result = credentials.filter(c =>
    (!tag || c.tags.some(t => t.toLowerCase() === tag))
    && (!search || [c.title, c.username, c.website, c.notes ?? '', ...c.tags].some(v => v.toLowerCase().includes(search)))
    && [...filters].every(filter => matchesFilter(c, filter, reused, now))
  );

  const byName = (a: CredentialItem, b: CredentialItem) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  switch (query.sort ?? 'name') {
    case 'recent': return result.sort((a, b) => b.createdAt - a.createdAt);
    case 'updated': return result.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'expiry': return result.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || byName(a, b));
    default: return result.sort((a, b) => Number(!!b.isFavorite) - Number(!!a.isFavorite) || byName(a, b));
  }
}

/** Nombre d'identifiants par filtre, pour afficher les compteurs */
export function countByFilter(credentials: CredentialItem[], now = Date.now()): Record<CredentialFilter, number> {
  const reused = reusedPasswords(credentials);
  const counts = Object.fromEntries(CREDENTIAL_FILTERS.map(f => [f, 0])) as Record<CredentialFilter, number>;
  for (const c of credentials) {
    for (const filter of CREDENTIAL_FILTERS) if (matchesFilter(c, filter, reused, now)) counts[filter]++;
  }
  return counts;
}
