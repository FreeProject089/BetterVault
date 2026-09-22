import { fromBase64, toBase64 } from './accountCrypto';

/**
 * Pièces jointes : chaque fichier a sa propre clé AES-256-GCM, rangée dans le coffre chiffré.
 * Le contenu chiffré vaut « version (1 octet) | IV (12) | données chiffrées ».
 *
 * Il est rangé à l'un des deux endroits :
 * - **sur le serveur**, pour un compte synchronisé : le serveur n'en voit que des octets ;
 * - **dans le coffre lui-même** (champ `data`), pour un coffre gardé sur cet appareil.
 *   Le fichier suit alors le coffre partout où il va, sans stockage séparé à gérer ni à
 *   perdre — au prix de la taille, d'où une limite nettement plus basse.
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
  /** Contenu chiffré (base64) quand le fichier est gardé dans le coffre au lieu du serveur */
  data?: string;
  /** Face d'une pièce d'identité scannée (recto ou verso) */
  side?: 'front' | 'back';
  createdAt: number;
}

/**
 * Taille maximale d'un fichier gardé dans le coffre. Bien plus basse que pour un compte
 * synchronisé : ici le fichier est déchiffré en mémoire avec tout le coffre à chaque
 * ouverture, et le base64 l'alourdit d'un tiers.
 */
export const MAX_LOCAL_ATTACHMENT_BYTES = 1024 * 1024;

/** Taille lisible d'une limite : « 1 Mo » plutôt que « 1024 Ko » */
export function formatLimit(bytes: number, locale: 'fr' | 'en'): string {
  const mo = bytes / 1048576;
  if (mo >= 1) return locale === 'fr' ? `${Math.round(mo)} Mo` : `${Math.round(mo)} MB`;
  return locale === 'fr' ? `${Math.round(bytes / 1024)} Ko` : `${Math.round(bytes / 1024)} KB`;
}

/** Octets occupés dans le coffre par les fichiers qui y sont rangés */
export function localAttachmentBytes(attachments: AttachmentMeta[] | undefined): number {
  return (attachments ?? []).reduce((total, file) => total + (file.data ? file.data.length : 0), 0);
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
  ).map(a => ({
    id: a.id,
    name: a.name.slice(0, 255),
    size: a.size,
    type: typeof a.type === 'string' ? a.type.slice(0, 100) : '',
    key: a.key,
    // Seul du base64 est accepté : un import ne peut pas glisser autre chose dans le coffre
    ...(typeof a.data === 'string' && /^[A-Za-z0-9+/=]*$/.test(a.data) ? { data: a.data } : {}),
    ...(a.side === 'front' || a.side === 'back' ? { side: a.side } : {}),
    createdAt: Number(a.createdAt) || Date.now()
  }));
  return list.length ? list : undefined;
}
