import { describe, it, expect } from 'vitest';
import {
  collectTwoFactor,
  exportAsUriList,
  exportAsJson,
  exportAsQrSheet,
  parseTwoFactorImport,
  withoutKnown
} from '../src/import_export/twoFactor';
import type { CredentialItem } from '../src/types/vault';

/**
 * Le secret TOTP voyage sous la forme otpauth:// que lisent toutes les
 * applications d'authentification. Un aller-retour ne doit rien perdre.
 */

const SECRET = 'JBSWY3DPEHPK3PXP';

const credential = (over: Partial<CredentialItem>): CredentialItem => ({
  id: 'cred-1', vaultId: 'vault-1', title: 'Compte', tags: [],
  createdAt: 0, updatedAt: 0, ...over
} as CredentialItem);

describe('Export des codes 2FA', () => {
  it('ne retient que les identifiants qui portent un secret', () => {
    const entries = collectTwoFactor([
      credential({ title: 'Banque', totpSecret: SECRET }),
      credential({ id: 'cred-2', title: 'Sans 2FA' }),
      credential({ id: 'cred-3', title: 'Vide', totpSecret: '   ' })
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Banque');
  });

  it('prend le compte et l’émetteur du site quand l’URI n’en porte pas', () => {
    const [entry] = collectTwoFactor([
      credential({ title: 'Banque', username: 'moi@exemple.fr', website: 'https://www.banque.fr', totpSecret: SECRET })
    ]);
    expect(entry.account).toBe('moi@exemple.fr');
    expect(entry.issuer).toBe('banque.fr');
    expect(entry.uri).toContain(`secret=${SECRET}`);
    expect(entry.uri).toContain('issuer=banque.fr');
  });

  it('garde l’émetteur d’origine quand le secret est déjà une URI', () => {
    const uri = `otpauth://totp/GitHub:moi?secret=${SECRET}&issuer=GitHub&digits=8&period=60`;
    const [entry] = collectTwoFactor([credential({ title: 'Mon GitHub', website: 'autre.fr', totpSecret: uri })]);
    expect(entry.issuer).toBe('GitHub');
    expect(entry.account).toBe('moi');
    // Les paramètres non standards survivent : sans eux le code serait faux
    expect(entry.uri).toContain('digits=8');
    expect(entry.uri).toContain('period=60');
  });

  it('écrit une URI par ligne', () => {
    const entries = collectTwoFactor([
      credential({ title: 'A', totpSecret: SECRET }),
      credential({ id: 'b', title: 'B', totpSecret: SECRET })
    ]);
    const lignes = exportAsUriList(entries).trim().split('\n');
    expect(lignes).toHaveLength(2);
    expect(lignes.every(l => l.startsWith('otpauth://totp/'))).toBe(true);
  });

  it('écrit un JSON relisible par l’import', () => {
    const entries = collectTwoFactor([credential({ title: 'Banque', totpSecret: SECRET })]);
    const json = exportAsJson(entries, new Date('2026-01-15T10:00:00Z'));
    expect(JSON.parse(json)).toMatchObject({ format: 'bettervault.2fa', version: 1, exportedAt: '2026-01-15T10:00:00.000Z' });

    const relu = parseTwoFactorImport(json);
    expect(relu.rejected).toEqual([]);
    expect(relu.entries[0].secret).toBe(SECRET);
    expect(relu.entries[0].title).toBe('Banque');
  });

  it('produit une planche de QR codes qui échappe les noms', () => {
    const entries = collectTwoFactor([credential({ title: '<script>alert(1)</script>', totpSecret: SECRET })]);
    const html = exportAsQrSheet(entries, () => '<svg></svg>', { title: 'Codes', warning: 'Attention', empty: 'Aucun' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<svg></svg>');
  });

  it('dit clairement qu’il n’y a rien plutôt que d’imprimer une page vide', () => {
    const html = exportAsQrSheet([], () => '', { title: 'Codes', warning: 'Attention', empty: 'Aucun code 2FA' });
    expect(html).toContain('Aucun code 2FA');
  });
});

describe('Import des codes 2FA', () => {
  it('lit une liste d’URI, en ignorant les lignes vides et les commentaires', () => {
    const { entries, rejected } = parseTwoFactorImport(`
      # mes codes
      otpauth://totp/GitHub:moi?secret=${SECRET}&issuer=GitHub

      otpauth://totp/Banque?secret=${SECRET}
    `);
    expect(entries).toHaveLength(2);
    expect(rejected).toEqual([]);
    expect(entries[0].title).toBe('GitHub');
  });

  it('accepte un secret nu, sans emballage', () => {
    const { entries } = parseTwoFactorImport(`${SECRET}\njbswy3dp ehpk 3pxp`);
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.secret === SECRET)).toBe(true);
  });

  it('rend les lignes non reconnues au lieu de les perdre en silence', () => {
    const { entries, rejected } = parseTwoFactorImport(`${SECRET}\npas-un-secret-du-tout!!\notpauth://hotp/X?secret=${SECRET}`);
    expect(entries).toHaveLength(1);
    // Le HOTP n'est pas du TOTP : il est refusé, et on le dit
    expect(rejected).toHaveLength(2);
    expect(rejected[0]).toContain('pas-un-secret');
  });

  it('lit aussi un JSON venu d’ailleurs, tant qu’il porte des URI', () => {
    const { entries } = parseTwoFactorImport(JSON.stringify([
      { name: 'Ailleurs', url: `otpauth://totp/Ailleurs?secret=${SECRET}` }
    ]));
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Ailleurs');
  });

  it('n’importe pas deux fois le même secret', () => {
    const { entries } = parseTwoFactorImport(`otpauth://totp/A?secret=${SECRET}\notpauth://totp/B?secret=${SECRET}`);
    expect(entries).toHaveLength(2);

    // Le coffre en possède déjà un : il ne doit pas revenir, ni son jumeau
    const filtres = withoutKnown(entries, [credential({ totpSecret: SECRET })]);
    expect(filtres).toHaveLength(0);
  });

  it('écarte les doublons internes même sans rien dans le coffre', () => {
    const { entries } = parseTwoFactorImport(`otpauth://totp/A?secret=${SECRET}\n${SECRET}`);
    expect(withoutKnown(entries, [])).toHaveLength(1);
  });

  it('ne rend rien pour une saisie vide', () => {
    expect(parseTwoFactorImport('   ')).toEqual({ entries: [], rejected: [] });
  });
});
