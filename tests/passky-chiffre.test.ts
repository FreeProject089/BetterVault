import { describe, it, expect } from 'vitest';
import { decryptPasskyBackup, isPasskyEncrypted, passkyDecryptField, passkyEncryptField, PasskyWrongCredentialsError } from '../src/import_export/passkyCrypto';

/**
 * Sauvegarde chiffrée de Passky : format XChaCha20-JS (non standard) et clé
 * Argon2id tirée du compte. Les valeurs de test sont factices.
 */

const KEY = 'a3f1'.repeat(32);
const NONCE = Uint8Array.from({ length: 24 }, (_, i) => (i * 37 + 11) & 255);

// Une vraie sauvegarde Passky (champ « website » de la première entrée), fournie pour la forme seulement
const REEL = 'GgPDojoyXcKRwq/Dp3ElMT4bw68bCW5SE8O2BcKbA8OGwoVdfnfDhsKJwr7DqsOCKsOiHVN0wr3DtynDmUTCkgw=';

describe('Champs Passky', () => {
  it('relit ce qu’il chiffre, accents, emoji et textes longs compris', () => {
    for (const text of ['', 'exemple.fr', 'mot de passe é à ç', 'clé 🔑 ok', 'x'.repeat(64), 'y'.repeat(200)]) {
      expect(passkyDecryptField(passkyEncryptField(text, KEY, NONCE), KEY)).toBe(text);
    }
  });

  it('a la forme Passky : un élément de plus que le texte, puis le nonce', () => {
    const cipher = passkyEncryptField('abc', KEY, NONCE);
    const codes = Array.from(new TextDecoder().decode(Uint8Array.from(atob(cipher), c => c.charCodeAt(0))));
    expect(codes.length).toBe(3 + 1 + 24);
  });

  it('lit la forme d’un vrai champ de sauvegarde Passky', () => {
    // Sans le compte, le texte n'est pas lisible ; mais le format (base64 → UTF-8 → nonce final) est reconnu
    expect(() => passkyDecryptField(REEL, KEY)).not.toThrow();
  });

  it('ne tombe pas sur le bon texte avec une autre clé', () => {
    const cipher = passkyEncryptField('mon-mot-de-passe', KEY, NONCE);
    expect(passkyDecryptField(cipher, 'b4'.repeat(64))).not.toBe('mon-mot-de-passe');
  });
});

describe('Sauvegarde complète', () => {
  it('reconnaît une sauvegarde chiffrée', () => {
    expect(isPasskyEncrypted({ encrypted: true, passwords: [{ website: 'x', username: 'y', password: 'z', message: '' }] })).toBe(true);
    expect(isPasskyEncrypted({ encrypted: false, passwords: [] })).toBe(false);
  });

  it('refuse un mauvais compte sans renvoyer de texte illisible', async () => {
    const backup = { encrypted: true, passwords: [{ website: REEL, username: REEL, password: REEL, message: REEL }] };
    await expect(decryptPasskyBackup(backup, 'personne', 'faux-mot-de-passe')).rejects.toBeInstanceOf(PasskyWrongCredentialsError);
  }, 60_000);
});
