import { argon2idAsync } from '@noble/hashes/argon2.js';
import { nativeArgon2id } from '../platform/tauriBridge';

/**
 * Export chiffré avec mot de passe dédié : Argon2id (KDF) + AES-256-GCM.
 * Les paramètres KDF et le sel sont authentifiés comme données associées (AAD)
 * pour empêcher toute altération silencieuse de l'en-tête.
 */

export const ENCRYPTED_EXPORT_FORMAT = 'bettervault-encrypted-export';
export const MIN_EXPORT_PASSWORD_LENGTH = 10;

export interface Argon2Params {
  t: number; // itérations
  m: number; // mémoire en KiB
  p: number; // parallélisme
}

export const DEFAULT_EXPORT_KDF: Argon2Params = { t: 3, m: 65536, p: 4 };

export interface EncryptedExportFile {
  format: typeof ENCRYPTED_EXPORT_FORMAT;
  version: 1;
  kdf: 'Argon2id';
  kdfParams: Argon2Params;
  cipher: 'AES-256-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

export async function deriveArgon2idKey(password: string, salt: Uint8Array, params: Argon2Params): Promise<Uint8Array> {
  const native = await nativeArgon2id(password, salt, params);
  if (native) return native;
  return argon2idAsync(encoder.encode(password), salt, { t: params.t, m: params.m, p: params.p, dkLen: 32, asyncTick: 25 });
}

function associatedData(file: Pick<EncryptedExportFile, 'format' | 'version' | 'kdf' | 'kdfParams' | 'cipher' | 'salt'>): Uint8Array {
  return encoder.encode(JSON.stringify([file.format, file.version, file.kdf, file.kdfParams.t, file.kdfParams.m, file.kdfParams.p, file.cipher, file.salt]));
}

function assertSafeParams(params: Argon2Params): void {
  const { t, m, p } = params;
  const valid = [t, m, p].every(Number.isInteger)
    && t >= 1 && t <= 64
    && p >= 1 && p <= 16
    && m >= 8 * p && m <= 1 << 21; // 2 GiB max : évite un déni de service via un fichier piégé
  if (!valid) throw new Error('Paramètres Argon2id invalides dans le fichier chiffré');
}

export function isEncryptedExport(value: unknown): value is EncryptedExportFile {
  return !!value && typeof value === 'object' && (value as { format?: unknown }).format === ENCRYPTED_EXPORT_FORMAT;
}

export async function encryptExport(plaintext: string, password: string, params: Argon2Params = DEFAULT_EXPORT_KDF): Promise<string> {
  if (password.length < MIN_EXPORT_PASSWORD_LENGTH) {
    throw new Error(`Le mot de passe d'export doit contenir au moins ${MIN_EXPORT_PASSWORD_LENGTH} caractères`);
  }
  assertSafeParams(params);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: ENCRYPTED_EXPORT_FORMAT as typeof ENCRYPTED_EXPORT_FORMAT,
    version: 1 as const,
    kdf: 'Argon2id' as const,
    kdfParams: { ...params },
    cipher: 'AES-256-GCM' as const,
    salt: toBase64(salt)
  };

  const keyBytes = await deriveArgon2idKey(password, salt, params);
  const key = await crypto.subtle.importKey('raw', toBuffer(keyBytes), 'AES-GCM', false, ['encrypt']);
  keyBytes.fill(0);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(associatedData(header)) },
    key,
    toBuffer(encoder.encode(plaintext))
  );

  const file: EncryptedExportFile = {
    ...header,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString()
  };
  return JSON.stringify(file, null, 2);
}

export async function decryptExport(file: EncryptedExportFile, password: string): Promise<string> {
  if (file.version !== 1 || file.kdf !== 'Argon2id' || file.cipher !== 'AES-256-GCM') {
    throw new Error('Version ou algorithme d’export chiffré non supporté');
  }
  assertSafeParams(file.kdfParams);

  const salt = fromBase64(file.salt);
  const keyBytes = await deriveArgon2idKey(password, salt, file.kdfParams);
  const key = await crypto.subtle.importKey('raw', toBuffer(keyBytes), 'AES-GCM', false, ['decrypt']);
  keyBytes.fill(0);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(fromBase64(file.iv)), additionalData: toBuffer(associatedData(file)) },
      key,
      toBuffer(fromBase64(file.ciphertext))
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Mot de passe incorrect ou fichier altéré');
  }
}
