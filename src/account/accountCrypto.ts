import { deriveArgon2idKey, type Argon2Params } from '../import_export/encryptedExport';

/**
 * Cryptographie du compte BetterVault.
 *
 * mot de passe maître ──Argon2id──▶ clé maître ──HKDF──┬─▶ clé de chiffrement (enveloppe la clé du coffre)
 *                                                      └─▶ preuve d'authentification (seule valeur envoyée au serveur)
 *
 * Le coffre est chiffré avec une clé aléatoire indépendante du mot de passe ;
 * le serveur ne reçoit jamais ni le mot de passe, ni la clé maître, ni la clé du coffre.
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
  constructor(message = 'Mot de passe maître incorrect') {
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

export async function generateVaultKey(): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', toBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, raw };
}

export function wrapVaultKey(encKey: CryptoKey, rawVaultKey: Uint8Array): Promise<EncryptedBlob> {
  return encryptBytes(encKey, rawVaultKey, AAD.vaultKey);
}

export async function unwrapVaultKey(encKey: CryptoKey, wrapped: EncryptedBlob): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = await decryptBytes(encKey, wrapped, AAD.vaultKey);
  } catch {
    throw new WrongPasswordError();
  }
  try {
    return await crypto.subtle.importKey('raw', toBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
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
