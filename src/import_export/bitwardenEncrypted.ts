import type { CredentialItem } from '../types/vault';
import { MANAGER_EXPORTS } from './managerExports';

/**
 * Export Bitwarden « JSON chiffré, protégé par mot de passe ».
 *
 * Format public de Bitwarden (importable dans Bitwarden et Vaultwarden) :
 * - clé = PBKDF2-SHA256(mot de passe, sel en texte, itérations), 32 octets ;
 * - étirée par HKDF-Expand (SHA-256) en une clé de chiffrement (« enc ») et
 *   une clé d'authentification (« mac ») ;
 * - chaque texte chiffré est une EncString de type 2 :
 *   « 2.iv|données|mac », AES-256-CBC puis HMAC-SHA256(iv ‖ données).
 * Le champ `data` contient l'export JSON non chiffré, tel quel.
 */

export const BITWARDEN_PBKDF2_ITERATIONS = 600_000;

export interface BitwardenPasswordProtectedFile {
  encrypted: true;
  passwordProtected: true;
  salt: string;
  kdfType: 0;
  kdfIterations: number;
  kdfMemory?: number | null;
  kdfParallelism?: number | null;
  encKeyValidation_DO_NOT_EDIT: string;
  data: string;
}

interface StretchedKey { enc: Uint8Array; mac: Uint8Array }

const encoder = new TextEncoder();
const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

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

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', toBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, toBuffer(data)));
}

/** HKDF-Expand seul (RFC 5869 §2.3) : Bitwarden saute l'étape « extract » */
export async function hkdfExpandSha256(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  let previous: Uint8Array = new Uint8Array(0);
  for (let block = 1, offset = 0; offset < length; block++) {
    const input = new Uint8Array(previous.length + info.length + 1);
    input.set(previous, 0);
    input.set(info, previous.length);
    input[input.length - 1] = block;
    previous = await hmacSha256(prk, input);
    out.set(previous.subarray(0, Math.min(previous.length, length - offset)), offset);
    offset += previous.length;
  }
  return out;
}

async function deriveKey(password: string, salt: string, iterations: number): Promise<StretchedKey> {
  const base = await crypto.subtle.importKey('raw', toBuffer(encoder.encode(password)), 'PBKDF2', false, ['deriveBits']);
  const master = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toBuffer(encoder.encode(salt)), iterations },
    base,
    256
  ));
  const key = {
    enc: await hkdfExpandSha256(master, encoder.encode('enc'), 32),
    mac: await hkdfExpandSha256(master, encoder.encode('mac'), 32)
  };
  master.fill(0);
  return key;
}

async function encryptString(plaintext: string, key: StretchedKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aes = await crypto.subtle.importKey('raw', toBuffer(key.enc), 'AES-CBC', false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: toBuffer(iv) }, aes, toBuffer(encoder.encode(plaintext))));
  const macInput = new Uint8Array(iv.length + data.length);
  macInput.set(iv, 0);
  macInput.set(data, iv.length);
  const mac = await hmacSha256(key.mac, macInput);
  return `2.${toBase64(iv)}|${toBase64(data)}|${toBase64(mac)}`;
}

async function decryptString(encString: string, key: StretchedKey): Promise<string> {
  const match = /^2\.([^|]+)\|([^|]+)\|([^|]+)$/.exec(encString);
  if (!match) throw new Error('Texte chiffré Bitwarden non reconnu');
  const [iv, data, mac] = match.slice(1).map(fromBase64);
  const macInput = new Uint8Array(iv.length + data.length);
  macInput.set(iv, 0);
  macInput.set(data, iv.length);
  const expected = await hmacSha256(key.mac, macInput);
  // Comparaison à temps constant : ne pas révéler l'octet fautif
  let diff = expected.length ^ mac.length;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ (mac[i] ?? 0);
  if (diff !== 0) throw new Error('Mot de passe incorrect ou fichier altéré');
  const aes = await crypto.subtle.importKey('raw', toBuffer(key.enc), 'AES-CBC', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: toBuffer(iv) }, aes, toBuffer(data)));
}

export function isBitwardenPasswordProtected(value: unknown): value is BitwardenPasswordProtectedFile {
  const v = value as Partial<BitwardenPasswordProtectedFile> | null;
  return !!v && typeof v === 'object' && v.encrypted === true && v.passwordProtected === true && typeof v.data === 'string';
}

/** Chiffre un export Bitwarden JSON (non chiffré) avec un mot de passe */
export async function encryptBitwardenJson(clearJson: string, password: string, iterations = BITWARDEN_PBKDF2_ITERATIONS): Promise<string> {
  if (!password) throw new Error('Mot de passe requis');
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(password, salt, iterations);
  const file: BitwardenPasswordProtectedFile = {
    encrypted: true,
    passwordProtected: true,
    salt,
    kdfType: 0,
    kdfIterations: iterations,
    kdfMemory: null,
    kdfParallelism: null,
    encKeyValidation_DO_NOT_EDIT: await encryptString(crypto.randomUUID(), key),
    data: await encryptString(clearJson, key)
  };
  key.enc.fill(0);
  key.mac.fill(0);
  return JSON.stringify(file, null, 2);
}

/** Identifiants au format Bitwarden, chiffrés par mot de passe */
export function exportBitwardenEncrypted(credentials: CredentialItem[], password: string, iterations?: number): Promise<string> {
  const clear = MANAGER_EXPORTS.find(f => f.id === 'bitwarden-json')!.build(credentials);
  return encryptBitwardenJson(clear, password, iterations);
}

/** Relit un export protégé par mot de passe : rend le JSON Bitwarden en clair */
export async function decryptBitwardenJson(file: BitwardenPasswordProtectedFile, password: string): Promise<string> {
  if (file.kdfType !== 0) throw new Error('Seule la dérivation PBKDF2 est prise en charge');
  if (!Number.isInteger(file.kdfIterations) || file.kdfIterations < 5000 || file.kdfIterations > 2_000_000) {
    throw new Error('Nombre d’itérations PBKDF2 invalide');
  }
  const key = await deriveKey(password, file.salt, file.kdfIterations);
  try {
    await decryptString(file.encKeyValidation_DO_NOT_EDIT, key);
    return await decryptString(file.data, key);
  } finally {
    key.enc.fill(0);
    key.mac.fill(0);
  }
}
