import { x25519 } from '@noble/curves/ed25519.js';
import { fromBase64, toBase64, type EncryptedBlob } from './accountCrypto';

/**
 * Cryptographie du partage entre comptes.
 *
 * - Chaque compte a une paire X25519 ; la clé privée est chiffrée par la clé de son coffre personnel.
 * - La clé d'un coffre partagé est « scellée » pour chaque membre : X25519 éphémère → HKDF → AES-256-GCM.
 * - L'empreinte d'une clé publique permet de vérifier, hors de BetterVault, qu'on invite bien la bonne personne.
 */

const encoder = new TextEncoder();
const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

const AAD = {
  privateKey: 'bettervault/v1/sharing-private-key',
  sealed: 'bettervault/v1/shared-vault-key'
};

export class SharingKeyError extends Error {
  constructor(message = 'Clé de partage illisible') {
    super(message);
    this.name = 'SharingKeyError';
  }
}

export interface SharingKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function generateSharingKeyPair(): SharingKeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

async function sealingKey(shared: Uint8Array, ephemeralPublic: Uint8Array, recipientPublic: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', toBuffer(shared), 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(64);
  salt.set(ephemeralPublic, 0);
  salt.set(recipientPublic, 32);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: toBuffer(salt), info: toBuffer(encoder.encode('bettervault/v1/seal')) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Chiffre un secret (clé de coffre) pour la clé publique d'un destinataire */
export async function sealForRecipient(secret: Uint8Array, recipientPublicKey: Uint8Array): Promise<string> {
  const ephemeral = x25519.utils.randomSecretKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeral);
  const shared = x25519.getSharedSecret(ephemeral, recipientPublicKey);
  try {
    const key = await sealingKey(shared, ephemeralPublic, recipientPublicKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(encoder.encode(AAD.sealed)) },
      key,
      toBuffer(secret)
    ));
    const out = new Uint8Array(32 + 12 + ciphertext.length);
    out.set(ephemeralPublic, 0);
    out.set(iv, 32);
    out.set(ciphertext, 44);
    return toBase64(out);
  } finally {
    ephemeral.fill(0);
    shared.fill(0);
  }
}

export async function openSealed(sealed: string, privateKey: Uint8Array): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(sealed);
  } catch {
    throw new SharingKeyError();
  }
  if (bytes.length < 32 + 12 + 16) throw new SharingKeyError();
  const ephemeralPublic = bytes.slice(0, 32);
  const iv = bytes.slice(32, 44);
  const shared = x25519.getSharedSecret(privateKey, ephemeralPublic);
  try {
    const key = await sealingKey(shared, ephemeralPublic, x25519.getPublicKey(privateKey));
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(encoder.encode(AAD.sealed)) },
      key,
      toBuffer(bytes.slice(44))
    ));
  } catch {
    throw new SharingKeyError('Impossible d’ouvrir la clé de ce coffre partagé');
  } finally {
    shared.fill(0);
  }
}

export async function wrapPrivateKey(vaultKey: CryptoKey, privateKey: Uint8Array): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(encoder.encode(AAD.privateKey)) }, vaultKey, toBuffer(privateKey));
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function unwrapPrivateKey(vaultKey: CryptoKey, blob: EncryptedBlob): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(fromBase64(blob.iv)), additionalData: toBuffer(encoder.encode(AAD.privateKey)) },
      vaultKey,
      toBuffer(fromBase64(blob.ct))
    ));
  } catch {
    throw new SharingKeyError('Clés de partage illisibles (coffre réinitialisé ?). Quittez vos coffres partagés puis reconnectez-vous.');
  }
}

/** Empreinte lisible d'une clé publique, à comparer de vive voix : « 3F2A 91C4 0B7E D5A2 6C18 » */
export async function keyFingerprint(publicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', toBuffer(publicKey)));
  const hex = Array.from(digest.slice(0, 10), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{4}/g)!.join(' ');
}
