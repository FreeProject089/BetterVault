import { describe, it, expect } from 'vitest';
import { MANAGER_EXPORTS } from '../src/import_export/managerExports';
import { parseImportFile } from '../src/import_export/importEngine';
import type { CredentialItem } from '../src/types/vault';

const cred = (over: Partial<CredentialItem> = {}): CredentialItem => ({
  id: 'c1', vaultId: 'v1', title: 'GitHub', website: 'github.com', domain: 'github.com',
  username: 'octo', password: 'mot "de" passe, 1', totpSecret: 'JBSWY3DPEHPK3PXP', notes: 'ligne 1\nligne 2',
  tags: ['Travail'], isFavorite: true, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000,
  fields: [{ id: 'f1', label: 'PIN', value: '1234', isMasked: true }],
  ...over
} as CredentialItem);

const build = (id: string, list = [cred()]) => MANAGER_EXPORTS.find(e => e.id === id)!.build(list);

describe('Exports vers d’autres gestionnaires', () => {
  it('chaque format se relit par l’import de BetterVault', () => {
    for (const format of MANAGER_EXPORTS) {
      const result = parseImportFile(format.build([cred()]), `export.${format.extension}`);
      expect(result.count, format.id).toBe(1);
      const imported = result.credentials[0];
      expect(imported.password, format.id).toBe('mot "de" passe, 1');
      expect(imported.username, format.id).toBe('octo');
    }
  });

  it('Bitwarden garde la 2FA, les champs et le favori', () => {
    const json = JSON.parse(build('bitwarden-json'));
    expect(json.items[0]).toMatchObject({ type: 1, favorite: true, login: { totp: 'JBSWY3DPEHPK3PXP', uris: [{ uri: 'https://github.com' }] } });
    expect(json.items[0].fields[0]).toMatchObject({ name: 'PIN', value: '1234', type: 1 });
  });

  it('1Password et Apple reçoivent une adresse otpauth://', () => {
    expect(build('1password')).toContain('otpauth://totp/');
    expect(build('apple')).toContain('secret=JBSWY3DPEHPK3PXP');
  });

  it('les navigateurs ignorent les identifiants sans site', () => {
    const lines = build('chrome', [cred(), cred({ id: 'c2', website: '' })]).trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(build('firefox')).toContain('https://github.com');
  });

  it('neutralise les formules de tableur', () => {
    expect(build('lastpass', [cred({ title: '=HYPERLINK("x")' })])).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
