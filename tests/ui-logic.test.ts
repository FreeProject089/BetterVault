import { describe, it, expect } from 'vitest';
import { queryCredentials, countByFilter } from '../src/store/credentialFilters';
import { expiryInfo } from '../src/ui/expiry';
import { sanitizeIconBody, normalizeItemIcon, brandColors } from '../src/icons/iconLibrary';
import { generatePassphrase, generateStrongPassword, passphraseEntropyBits, PASSPHRASE_WORDLIST } from '../src/crypto/vaultCrypto';
import type { CredentialItem } from '../src/types/vault';

const fr = (text: string) => text;
const DAY = 86_400_000;
const NOW = new Date(2026, 8, 15, 10).getTime();

const cred = (overrides: Partial<CredentialItem>): CredentialItem => ({
  id: Math.random().toString(36).slice(2),
  vaultId: 'v',
  title: 'Sans nom',
  username: '',
  password: 'K7#pq!Lm29@zXw4$',
  website: '',
  domain: '',
  tags: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides
});

describe('Filtres de la liste', () => {
  const items = [
    cred({ title: 'Banque', isFavorite: true, totpSecret: 'JBSWY3DPEHPK3PXP', expiresAt: NOW + 3 * DAY, tags: ['Finances'] }),
    cred({ title: 'Forum', password: 'azerty' }),
    cred({ title: 'Mail', password: 'azerty', expiresAt: NOW - DAY }),
    cred({ title: 'Clé', password: '', passkeys: [{ credentialId: 'x', publicKey: 'y', signCount: 0, rpId: 'a.fr', userName: 'u', createdAt: NOW }] })
  ];

  it('combine les filtres, la recherche, le tag et le tri', () => {
    expect(queryCredentials(items, { filters: new Set(['reused']) }, NOW).map(c => c.title)).toEqual(['Forum', 'Mail']);
    expect(queryCredentials(items, { filters: new Set(['reused', 'expired']) }, NOW).map(c => c.title)).toEqual(['Mail']);
    expect(queryCredentials(items, { filters: new Set(['expiring']) }, NOW).map(c => c.title)).toEqual(['Banque']);
    expect(queryCredentials(items, { search: 'finan' }, NOW).map(c => c.title)).toEqual(['Banque']);
    expect(queryCredentials(items, { tag: 'finances' }, NOW).map(c => c.title)).toEqual(['Banque']);
    expect(queryCredentials(items, { sort: 'expiry' }, NOW).map(c => c.title).slice(0, 2)).toEqual(['Mail', 'Banque']);
    // Tri par nom : favoris d'abord
    expect(queryCredentials(items, {}, NOW)[0].title).toBe('Banque');
  });

  it('compte les éléments de chaque filtre', () => {
    expect(countByFilter(items, NOW)).toMatchObject({ favorites: 1, totp: 1, passkeys: 1, expiring: 1, expired: 1, reused: 2, noPassword: 1, weak: 2 });
  });
});

describe('Expiration', () => {
  it('donne un libellé court selon l’urgence', () => {
    expect(expiryInfo(NOW - 2 * DAY, fr, 'fr-FR', NOW)).toMatchObject({ state: 'expired', short: 'Expiré' });
    expect(expiryInfo(NOW + 2 * 3600_000, fr, 'fr-FR', NOW)).toMatchObject({ state: 'today' });
    expect(expiryInfo(NOW + 5 * DAY, fr, 'fr-FR', NOW)).toMatchObject({ state: 'critical', short: '5 j', days: 5 });
    expect(expiryInfo(NOW + 20 * DAY, fr, 'fr-FR', NOW)).toMatchObject({ state: 'soon', short: '20 j' });
    expect(expiryInfo(NOW + 120 * DAY, fr, 'fr-FR', NOW)).toMatchObject({ state: 'ok', short: '4 mois' });
    expect(expiryInfo(undefined, fr, 'fr-FR', NOW)).toBeNull();
  });
});

describe('Icônes', () => {
  it('ne garde que des formes SVG sûres', () => {
    expect(sanitizeIconBody('<path d="M0 0h24v24H0z"/><circle cx="12" cy="12" r="3"></circle>')).toBe('<path d="M0 0h24v24H0z"/><circle cx="12" cy="12" r="3"></circle>');
    expect(sanitizeIconBody('<script>alert(1)</script>')).toBe('');
    expect(sanitizeIconBody('<path d="M0 0" onload="alert(1)"/>')).toBe('');
    expect(sanitizeIconBody('<path d="url(javascript:alert(1))"/>')).toBe('');
    expect(sanitizeIconBody('<image href="https://exemple.fr/x.png"/>')).toBe('');
    expect(sanitizeIconBody('texte <path d="M0 0"/>')).toBe('');
    expect(normalizeItemIcon({ set: 'lucide', name: 'lock', body: '<rect x="3" y="11" width="18" height="11"/>' })).toMatchObject({ set: 'lucide', name: 'lock' });
    expect(normalizeItemIcon({ set: 'autre', name: 'x', body: '<path d="M0 0"/>' })).toBeUndefined();
  });

  it('rend un logo noir lisible sur fond sombre et un logo blanc lisible sur fond clair', () => {
    expect(brandColors('000000').onDark).toBe('#e6edf3');
    expect(brandColors('FFFFFF').onLight).toBe('#1f2328');
    expect(brandColors('7773E8')).toEqual({ onDark: '#7773E8', onLight: '#7773E8' });
  });
});

describe('Générateur', () => {
  it('produit des phrases secrètes selon les réglages', () => {
    const words = new Set(PASSPHRASE_WORDLIST);
    const phrase = generatePassphrase({ wordCount: 12, separator: '.', wordCase: 'upper', includeNumber: true, numberDigits: 4, includeSymbol: true });
    const parts = phrase.split('.');
    expect(parts).toHaveLength(14);
    expect(parts.slice(0, 12).every(w => w === w.toUpperCase() && words.has(w.toLowerCase()))).toBe(true);
    expect(parts[12]).toMatch(/^\d{4}$/);
    expect(parts[13]).toMatch(/^[!#$%&*+\-=?@^_~]$/);
    expect(generatePassphrase({ wordCount: 50, separator: ' ', includeNumber: false }).split(' ')).toHaveLength(20);
    expect(passphraseEntropyBits({ wordCount: 6, separator: '-', includeNumber: false })).toBe(78);
  });

  it('exclut les caractères demandés', () => {
    for (let i = 0; i < 20; i++) {
      const password = generateStrongPassword({ length: 64, uppercase: true, lowercase: true, numbers: true, symbols: true, avoidAmbiguous: false, exclude: 'aeiou{}[]' });
      expect(password).toHaveLength(64);
      expect(password).not.toMatch(/[aeiou{}[\]]/);
    }
  });
});
