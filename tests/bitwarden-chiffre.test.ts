import { describe, it, expect } from 'vitest';
import { decryptBitwardenJson, exportBitwardenEncrypted, hkdfExpandSha256, isBitwardenPasswordProtected } from '../src/import_export/bitwardenEncrypted';
import { parseImportFile } from '../src/import_export/importEngine';
import type { CredentialItem } from '../src/types/vault';

const hex = (value: string) => Uint8Array.from(value.match(/../g)!.map(b => parseInt(b, 16)));
const toHex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

const cred = {
  id: 'c1', vaultId: 'v1', title: 'GitHub', website: 'github.com', domain: 'github.com',
  username: 'octo', password: 'mot de passe é', totpSecret: 'JBSWY3DPEHPK3PXP', notes: '',
  tags: [], isFavorite: false, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000
} as unknown as CredentialItem;

describe('Export Bitwarden chiffré par mot de passe', () => {
  it('HKDF-Expand suit la RFC 5869 (cas de test 1)', async () => {
    const prk = hex('077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5');
    const okm = await hkdfExpandSha256(prk, hex('f0f1f2f3f4f5f6f7f8f9'), 42);
    expect(toHex(okm)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });

  it('a la forme attendue par Bitwarden et se relit avec le bon mot de passe', async () => {
    const text = await exportBitwardenEncrypted([cred], 'un mot de passe solide', 5000);
    const file = JSON.parse(text);
    expect(isBitwardenPasswordProtected(file)).toBe(true);
    expect(file).toMatchObject({ encrypted: true, passwordProtected: true, kdfType: 0, kdfIterations: 5000 });
    expect(file.data).toMatch(/^2\.[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+$/);
    expect(text).not.toContain('octo');

    const clear = await decryptBitwardenJson(file, 'un mot de passe solide');
    const imported = parseImportFile(clear, 'bitwarden.json');
    expect(imported.credentials[0]).toMatchObject({ username: 'octo', password: 'mot de passe é' });
  });

  it('refuse un mauvais mot de passe ou un fichier altéré', async () => {
    const file = JSON.parse(await exportBitwardenEncrypted([cred], 'un mot de passe solide', 5000));
    await expect(decryptBitwardenJson(file, 'mauvais mot de passe')).rejects.toThrow();
    const [iv, data, mac] = file.data.slice(2).split('|');
    const flipped = data.startsWith('A') ? 'B' + data.slice(1) : 'A' + data.slice(1);
    await expect(decryptBitwardenJson({ ...file, data: `2.${iv}|${flipped}|${mac}` }, 'un mot de passe solide')).rejects.toThrow();
  });
});
