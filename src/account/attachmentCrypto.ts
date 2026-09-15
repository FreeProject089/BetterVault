import { fromBase64, toBase64 } from './accountCrypto';

/**
 * Pièces jointes : chaque fichier a sa propre clé AES-256-GCM, rangée dans le coffre chiffré.
 * Le serveur ne reçoit que « version (1 octet) | IV (12) | données chiffrées ».
 */

const AAD = new TextEncoder().encode('bettervault/v1/attachment');
const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;
const VERSION = 1;

export interface AttachmentMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Clé du fichier (base64), jamais envoyée seule au serveur */
  key: string;
  createdAt: number;
}

export async function encryptFile(data: Uint8Array): Promise<{ payload: Uint8Array; key: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', toBuffer(raw), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(AAD) }, key, toBuffer(data)));
  const payload = new Uint8Array(1 + 12 + ciphertext.length);
  payload[0] = VERSION;
  payload.set(iv, 1);
  payload.set(ciphertext, 13);
  const encoded = toBase64(raw);
  raw.fill(0);
  return { payload, key: encoded };
}

export async function decryptFile(payload: Uint8Array, keyBase64: string): Promise<Uint8Array> {
  if (payload[0] !== VERSION || payload.length < 13 + 16) throw new Error('Pièce jointe dans un format inconnu');
  const key = await crypto.subtle.importKey('raw', toBuffer(fromBase64(keyBase64)), 'AES-GCM', false, ['decrypt']);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(payload.slice(1, 13)), additionalData: toBuffer(AAD) },
      key,
      toBuffer(payload.slice(13))
    ));
  } catch {
    throw new Error('Pièce jointe altérée ou clé incorrecte');
  }
}

export function normalizeAttachments(input: unknown): AttachmentMeta[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const list = input.filter((a): a is AttachmentMeta =>
    !!a && typeof a === 'object'
    && typeof a.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(a.id)
    && typeof a.name === 'string' && typeof a.key === 'string'
    && Number.isFinite(a.size)
  ).map(a => ({ id: a.id, name: a.name.slice(0, 255), size: a.size, type: typeof a.type === 'string' ? a.type.slice(0, 100) : '', key: a.key, createdAt: Number(a.createdAt) || Date.now() }));
  return list.length ? list : undefined;
}
