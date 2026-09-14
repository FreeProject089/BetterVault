import { deriveArgon2idKey, type Argon2Params } from '../import_export/encryptedExport';

/**
 * Cryptographie du compte BetterVault.
 *
 * mot de passe principal ──Argon2id──▶ clé principale ──HKDF──┬─▶ clé de chiffrement (enveloppe la clé du coffre)
 *                                                      └─▶ preuve d'authentification (seule valeur envoyée au serveur)
 *
 * Le coffre est chiffré avec une clé aléatoire indépendante du mot de passe ;
 * le serveur ne reçoit jamais ni le mot de passe, ni la clé principale, ni la clé du coffre.
 */

export const ACCOUNT_KDF: Argon2Params = { t: 3, m: 65536, p: 4 };

export interface EncryptedBlob {
  v: 1;
  iv: string;
  ct: string;
}

export interface AccountKeys {
  encKey: CryptoKey;
  authHash: string;
}

export class WrongPasswordError extends Error {
  constructor(message = 'Mot de passe principal incorrect') {
    super(message);
    this.name = 'WrongPasswordError';
  }
}

const AAD = {
  vaultKey: 'bettervault/v1/vault-key',
  vault: 'bettervault/v1/vault'
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function deriveAccountKeys(password: string, salt: Uint8Array, kdf: Argon2Params): Promise<AccountKeys> {
  const master = await deriveArgon2idKey(password, salt, kdf);
  const hkdfKey = await crypto.subtle.importKey('raw', toBuffer(master), 'HKDF', false, ['deriveKey', 'deriveBits']);
  master.fill(0);

  const params = (label: string): HkdfParams => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new ArrayBuffer(0),
    info: toBuffer(encoder.encode(label))
  });

  const encKey = await crypto.subtle.deriveKey(params('bettervault/v1/encryption'), hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const authBits = await crypto.subtle.deriveBits(params('bettervault/v1/authentication'), hkdfKey, 256);
  return { encKey, authHash: toBase64(new Uint8Array(authBits)) };
}

async function encryptBytes(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(encoder.encode(aad)) },
    key,
    toBuffer(plaintext)
  );
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ciphertext)) };
}

async function decryptBytes(key: CryptoKey, blob: EncryptedBlob, aad: string): Promise<Uint8Array> {
  if (blob?.v !== 1) throw new Error('Format chiffré non supporté');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(fromBase64(blob.iv)), additionalData: toBuffer(encoder.encode(aad)) },
    key,
    toBuffer(fromBase64(blob.ct))
  );
  return new Uint8Array(plaintext);
}

/** Importe une clé de coffre brute ; extractable uniquement pour la mémoriser dans une session d'extension */
export function importVaultKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toBuffer(raw), 'AES-GCM', extractable, ['encrypt', 'decrypt']);
}

export async function exportVaultKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

export async function generateVaultKey(extractable = false): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await importVaultKey(raw, extractable);
  return { key, raw };
}

export function wrapVaultKey(encKey: CryptoKey, rawVaultKey: Uint8Array): Promise<EncryptedBlob> {
  return encryptBytes(encKey, rawVaultKey, AAD.vaultKey);
}

export async function unwrapVaultKey(encKey: CryptoKey, wrapped: EncryptedBlob, extractable = false): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = await decryptBytes(encKey, wrapped, AAD.vaultKey);
  } catch {
    throw new WrongPasswordError();
  }
  try {
    return await importVaultKey(raw, extractable);
  } finally {
    raw.fill(0);
  }
}

/** Re-chiffre la clé du coffre avec une nouvelle clé (changement de mot de passe principal) sans toucher au coffre */
export async function rewrapVaultKey(oldEncKey: CryptoKey, wrapped: EncryptedBlob, newEncKey: CryptoKey): Promise<EncryptedBlob> {
  let raw: Uint8Array;
  try {
    raw = await decryptBytes(oldEncKey, wrapped, AAD.vaultKey);
  } catch {
    throw new WrongPasswordError('Mot de passe principal actuel incorrect');
  }
  try {
    return await encryptBytes(newEncKey, raw, AAD.vaultKey);
  } finally {
    raw.fill(0);
  }
}

/* ── Clé de secours ─────────────────────────────────────────────────────────
 * 256 bits aléatoires affichés en Base32 (13 groupes de 4 caractères).
 * Elle chiffre une seconde copie de la clé du coffre : avec elle, un mot de passe oublié ne fait rien perdre.
 * Déjà aléatoire, elle n'a pas besoin d'Argon2 : HKDF suffit.
 */

const RECOVERY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export class InvalidRecoveryKeyError extends Error {
  constructor(message = 'Clé de secours invalide') {
    super(message);
    this.name = 'InvalidRecoveryKeyError';
  }
}

export function generateRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

export function parseRecoveryKey(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  if (clean.length !== 52) throw new InvalidRecoveryKeyError('La clé de secours doit contenir 52 caractères');
  const out = new Uint8Array(32);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = RECOVERY_ALPHABET.indexOf(char);
    if (digit === -1) throw new InvalidRecoveryKeyError(`Caractère « ${char} » inattendu dans la clé de secours`);
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      if (index < 32) out[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}

export async function deriveRecoveryKeys(recoveryKey: Uint8Array): Promise<AccountKeys> {
  const hkdfKey = await crypto.subtle.importKey('raw', toBuffer(recoveryKey), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const params = (label: string): HkdfParams => ({ name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(0), info: toBuffer(encoder.encode(label)) });
  const encKey = await crypto.subtle.deriveKey(params('bettervault/v1/recovery-encryption'), hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const authBits = await crypto.subtle.deriveBits(params('bettervault/v1/recovery-authentication'), hkdfKey, 256);
  return { encKey, authHash: toBase64(new Uint8Array(authBits)) };
}

/** Déchiffre la clé du coffre avec la clé de secours */
export async function unwrapWithRecoveryKey(recoveryEncKey: CryptoKey, wrapped: EncryptedBlob, extractable = false): Promise<CryptoKey> {
  try {
    return await unwrapVaultKey(recoveryEncKey, wrapped, extractable);
  } catch {
    throw new InvalidRecoveryKeyError('Clé de secours incorrecte');
  }
}

export function encryptVaultJson(vaultKey: CryptoKey, json: string): Promise<EncryptedBlob> {
  return encryptBytes(vaultKey, encoder.encode(json), AAD.vault);
}

export async function decryptVaultData<T>(vaultKey: CryptoKey, blob: EncryptedBlob): Promise<T> {
  let plaintext: Uint8Array;
  try {
    plaintext = await decryptBytes(vaultKey, blob, AAD.vault);
  } catch {
    throw new Error('Coffre illisible : données altérées ou clé incorrecte');
  }
  return JSON.parse(decoder.decode(plaintext)) as T;
}
