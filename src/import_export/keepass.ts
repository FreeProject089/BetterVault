import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { argon2dAsync, argon2idAsync } from '@noble/hashes/argon2.js';
import { cbc, ecb } from '@noble/ciphers/aes.js';
import { chacha20 } from '@noble/ciphers/chacha.js';
import { salsa20 } from '@noble/ciphers/salsa.js';
import { gunzipSync, gzipSync } from 'fflate';
import { CredentialField, CredentialItem, PasskeyData } from '../types/vault';
import { normalizeTotpInput, toOtpAuthUri } from '../crypto/otpauthUri';
import { XmlNode, child, children, encodeXmlText, nodeText, parseXml } from './xml';

/**
 * KeePass : lecture des bases KDBX 3.1 / 4.x (AES-KDF, Argon2d, Argon2id ;
 * AES-256 ou ChaCha20), des exports XML, et écriture KDBX 4.0.
 */

const SIG1 = 0x9aa2d903;
const SIG2 = 0xb54bfb67;
const CIPHER_AES256 = '31c1f2e6bf714350be5805216afc5aff';
const CIPHER_CHACHA20 = 'd6038a2b8b6f4cb5a524339a31dbb59a';
const KDF_AES_KDBX3 = 'c9d9f39a628a4460bf740d08c18a4fea';
const KDF_AES_KDBX4 = '7c02bb8279a74ac0927d114a00648238';
const KDF_ARGON2D = 'ef636ddf8c29444b91f7a9a403e30a0c';
const KDF_ARGON2ID = '9e298b1956db4773b23dfc3ec6f0a1e6';
const SALSA20_IV = new Uint8Array([0xe8, 0x30, 0x09, 0x4b, 0x97, 0x20, 0x5d, 0x2a]);
const KEEPASS_EPOCH_OFFSET_S = 62135596800; // secondes entre 0001-01-01 et 1970-01-01
const WRONG_KEY = 'Mot de passe ou fichier clé incorrect';

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

export class KdbxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KdbxError';
  }
}

/* ── Utilitaires binaires ─────────────────────────────────────────────── */

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

class ByteReader {
  pos: number;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array, start = 0) {
    this.bytes = bytes;
    this.pos = start;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.bytes.length) throw new KdbxError('Fichier KDBX tronqué ou corrompu');
  }

  u8(): number { this.need(1); return this.bytes[this.pos++]; }
  u16(): number { this.need(2); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32(): number { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32(): number { this.need(4); const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  u64(): bigint { this.need(8); const v = this.view.getBigUint64(this.pos, true); this.pos += 8; return v; }

  read(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

/* ── En-tête ──────────────────────────────────────────────────────────── */

type VariantValue = number | bigint | boolean | string | Uint8Array;

function parseVariantDictionary(data: Uint8Array): Map<string, VariantValue> {
  const r = new ByteReader(data);
  const version = r.u16();
  if ((version & 0xff00) !== 0x0100) throw new KdbxError('Dictionnaire de paramètres KDF non supporté');
  const map = new Map<string, VariantValue>();
  for (;;) {
    const type = r.u8();
    if (type === 0) break;
    const key = utf8Decoder.decode(r.read(r.i32()));
    const value = r.read(r.i32());
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    switch (type) {
      case 0x04: map.set(key, view.getUint32(0, true)); break;
      case 0x05: map.set(key, view.getBigUint64(0, true)); break;
      case 0x08: map.set(key, value[0] !== 0); break;
      case 0x0c: map.set(key, view.getInt32(0, true)); break;
      case 0x0d: map.set(key, view.getBigInt64(0, true)); break;
      case 0x18: map.set(key, utf8Decoder.decode(value)); break;
      case 0x42: map.set(key, value.slice()); break;
      default: break;
    }
  }
  return map;
}

function buildVariantDictionary(entries: Array<[string, 0x04 | 0x05 | 0x42, number | bigint | Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [u16le(0x0100)];
  for (const [key, type, value] of entries) {
    const valueBytes = type === 0x04 ? u32le(value as number) : type === 0x05 ? u64le(value as bigint) : (value as Uint8Array);
    const keyBytes = utf8.encode(key);
    parts.push(new Uint8Array([type]), u32le(keyBytes.length), keyBytes, u32le(valueBytes.length), valueBytes);
  }
  parts.push(new Uint8Array([0]));
  return concatBytes(...parts);
}

interface KdbxHeader {
  major: number;
  minor: number;
  cipherId: string;
  compression: number;
  masterSeed: Uint8Array;
  encryptionIV: Uint8Array;
  transformSeed?: Uint8Array;
  transformRounds?: bigint;
  protectedStreamKey?: Uint8Array;
  streamStartBytes?: Uint8Array;
  innerRandomStreamId?: number;
  kdfParams?: Map<string, VariantValue>;
  headerEnd: number;
}

export function isKdbx(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === SIG1 && view.getUint32(4, true) === SIG2;
}

export function getKdbxVersion(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return `${view.getUint16(10, true)}.${view.getUint16(8, true)}`;
}

function readHeader(bytes: Uint8Array): KdbxHeader {
  if (!isKdbx(bytes)) throw new KdbxError('Signature KDBX invalide');
  const r = new ByteReader(bytes, 8);
  const minor = r.u16();
  const major = r.u16();
  if (major !== 3 && major !== 4) throw new KdbxError(`Version KDBX ${major}.${minor} non supportée`);

  const header: Partial<KdbxHeader> = { major, minor, compression: 0 };
  for (;;) {
    const id = r.u8();
    const size = major >= 4 ? r.u32() : r.u16();
    const data = r.read(size);
    if (id === 0) break;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    switch (id) {
      case 2: header.cipherId = toHex(data); break;
      case 3: header.compression = view.getUint32(0, true); break;
      case 4: header.masterSeed = data.slice(); break;
      case 5: header.transformSeed = data.slice(); break;
      case 6: header.transformRounds = view.getBigUint64(0, true); break;
      case 7: header.encryptionIV = data.slice(); break;
      case 8: header.protectedStreamKey = data.slice(); break;
      case 9: header.streamStartBytes = data.slice(); break;
      case 10: header.innerRandomStreamId = view.getUint32(0, true); break;
      case 11: header.kdfParams = parseVariantDictionary(data); break;
      default: break;
    }
  }

  if (!header.cipherId || !header.masterSeed || !header.encryptionIV) {
    throw new KdbxError('En-tête KDBX incomplet');
  }
  return { ...header, headerEnd: r.pos } as KdbxHeader;
}

/* ── Dérivation de clé ────────────────────────────────────────────────── */

function hashKeyFile(keyFile: Uint8Array): Uint8Array {
  const text = utf8Decoder.decode(keyFile).trim();
  if (text.startsWith('<')) {
    try {
      const keyFileNode = child(parseXml(text), 'KeyFile');
      const data = child(child(keyFileNode, 'Key'), 'Data');
      if (data) {
        const version = nodeText(child(child(keyFileNode, 'Meta'), 'Version'));
        const raw = nodeText(data).replace(/\s+/g, '');
        return version.startsWith('2') ? fromHex(raw) : fromBase64(raw);
      }
    } catch {
      // Pas un fichier clé XML : traité comme fichier binaire arbitraire
    }
  }
  if (keyFile.length === 32) return keyFile;
  if (keyFile.length === 64 && /^[0-9a-fA-F]{64}$/.test(text)) return fromHex(text);
  return sha256(keyFile);
}

export function buildCompositeKey(password: string, keyFile?: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  if (password) parts.push(sha256(utf8.encode(password)));
  if (keyFile) parts.push(hashKeyFile(keyFile));
  return sha256(concatBytes(...parts));
}

function aesKdf(key: Uint8Array, seed: Uint8Array, rounds: bigint): Uint8Array {
  let data = key.slice();
  const n = Number(rounds);
  for (let i = 0; i < n; i++) {
    data = ecb(seed, { disablePadding: true }).encrypt(data);
  }
  return sha256(data);
}

async function transformKey(header: KdbxHeader, compositeKey: Uint8Array): Promise<Uint8Array> {
  if (header.major < 4) {
    if (!header.transformSeed || header.transformRounds === undefined) throw new KdbxError('Paramètres AES-KDF manquants');
    return aesKdf(compositeKey, header.transformSeed, header.transformRounds);
  }

  const params = header.kdfParams;
  const uuid = params?.get('$UUID');
  if (!params || !(uuid instanceof Uint8Array)) throw new KdbxError('Paramètres KDF manquants');
  const kdfId = toHex(uuid);

  if (kdfId === KDF_AES_KDBX3 || kdfId === KDF_AES_KDBX4) {
    return aesKdf(compositeKey, params.get('S') as Uint8Array, BigInt(params.get('R') as bigint));
  }

  if (kdfId === KDF_ARGON2D || kdfId === KDF_ARGON2ID) {
    const salt = params.get('S') as Uint8Array;
    const options = {
      t: Number(params.get('I')),
      m: Math.floor(Number(params.get('M')) / 1024),
      p: Number(params.get('P')),
      version: Number(params.get('V') ?? 0x13),
      dkLen: 32,
      asyncTick: 25
    };
    return kdfId === KDF_ARGON2D
      ? argon2dAsync(compositeKey, salt, options)
      : argon2idAsync(compositeKey, salt, options);
  }

  throw new KdbxError('Fonction de dérivation de clé KeePass non supportée');
}

function decryptPayload(cipherId: string, key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (cipherId === CIPHER_AES256) {
    try {
      return cbc(key, iv).decrypt(data);
    } catch {
      throw new KdbxError(WRONG_KEY);
    }
  }
  if (cipherId === CIPHER_CHACHA20) return chacha20(key, iv, data);
  throw new KdbxError('Algorithme de chiffrement non supporté (Twofish ?) — utilisez AES-256 ou ChaCha20');
}

/* ── Déchiffrement ────────────────────────────────────────────────────── */

interface DecryptedKdbx {
  xml: Uint8Array;
  streamId: number;
  streamKey: Uint8Array;
}

async function decryptV3(bytes: Uint8Array, header: KdbxHeader, compositeKey: Uint8Array): Promise<DecryptedKdbx> {
  const transformed = await transformKey(header, compositeKey);
  const masterKey = sha256(concatBytes(header.masterSeed, transformed));
  const plain = decryptPayload(header.cipherId, masterKey, header.encryptionIV, bytes.subarray(header.headerEnd));

  if (!header.streamStartBytes || !bytesEqual(plain.subarray(0, 32), header.streamStartBytes)) {
    throw new KdbxError(WRONG_KEY);
  }

  const r = new ByteReader(plain, 32);
  const parts: Uint8Array[] = [];
  for (;;) {
    const hash = r.read(32);
    r.u32();
    const size = r.u32();
    if (size === 0) break;
    const data = r.read(size);
    if (!bytesEqual(sha256(data), hash)) throw new KdbxError('Bloc de données KDBX corrompu');
    parts.push(data);
  }

  const payload = concatBytes(...parts);
  return {
    xml: header.compression === 1 ? gunzipSync(payload) : payload,
    streamId: header.innerRandomStreamId ?? 0,
    streamKey: header.protectedStreamKey ?? new Uint8Array(0)
  };
}

function blockHmacKey(hmacBase: Uint8Array, index: bigint): Uint8Array {
  return sha512(concatBytes(u64le(index), hmacBase));
}

async function decryptV4(bytes: Uint8Array, header: KdbxHeader, compositeKey: Uint8Array): Promise<DecryptedKdbx> {
  const headerBytes = bytes.subarray(0, header.headerEnd);
  const r = new ByteReader(bytes, header.headerEnd);
  const storedHash = r.read(32);
  const storedHmac = r.read(32);
  if (!bytesEqual(sha256(headerBytes), storedHash)) throw new KdbxError('En-tête KDBX corrompu');

  const transformed = await transformKey(header, compositeKey);
  const hmacBase = sha512(concatBytes(header.masterSeed, transformed, new Uint8Array([1])));
  if (!bytesEqual(hmac(sha256, blockHmacKey(hmacBase, 0xffffffffffffffffn), headerBytes), storedHmac)) {
    throw new KdbxError(WRONG_KEY);
  }

  const parts: Uint8Array[] = [];
  for (let index = 0n; ; index++) {
    const mac = r.read(32);
    const sizeBytes = r.read(4);
    const size = new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 4).getInt32(0, true);
    const data = r.read(size);
    const expected = hmac(sha256, blockHmacKey(hmacBase, index), concatBytes(u64le(index), sizeBytes, data));
    if (!bytesEqual(mac, expected)) throw new KdbxError('Bloc de données KDBX corrompu');
    if (size === 0) break;
    parts.push(data);
  }

  const encryptionKey = sha256(concatBytes(header.masterSeed, transformed));
  const decrypted = decryptPayload(header.cipherId, encryptionKey, header.encryptionIV, concatBytes(...parts));
  const plain = header.compression === 1 ? gunzipSync(decrypted) : decrypted;

  const inner = new ByteReader(plain);
  let streamId = 0;
  let streamKey = new Uint8Array(0);
  for (;;) {
    const id = inner.u8();
    const data = inner.read(inner.u32());
    if (id === 0) break;
    if (id === 1) streamId = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
    if (id === 2) streamKey = data.slice();
  }

  return { xml: plain.subarray(inner.pos), streamId, streamKey };
}

function innerKeystream(streamId: number, key: Uint8Array, length: number): Uint8Array {
  const zeros = new Uint8Array(length);
  if (length === 0 || streamId === 0) return zeros;
  if (streamId === 2) return salsa20(sha256(key), SALSA20_IV, zeros);
  if (streamId === 3) {
    const h = sha512(key);
    return chacha20(h.subarray(0, 32), h.subarray(32, 44), zeros);
  }
  throw new KdbxError(`Flux de protection interne ${streamId} non supporté`);
}

/** Déprotège les valeurs `Protected="True"` dans l'ordre du document (flux continu) */
function unprotectValues(root: XmlNode, streamId: number, streamKey: Uint8Array): void {
  const nodes: XmlNode[] = [];
  const walk = (node: XmlNode) => {
    if (node.name === 'Value' && node.attrs.Protected === 'True') nodes.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  if (nodes.length === 0) return;

  const cipherTexts = nodes.map(n => fromBase64(n.text.trim()));
  const keystream = innerKeystream(streamId, streamKey, cipherTexts.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  cipherTexts.forEach((ct, i) => {
    const pt = new Uint8Array(ct.length);
    for (let j = 0; j < ct.length; j++) pt[j] = ct[j] ^ keystream[offset + j];
    offset += ct.length;
    nodes[i].text = utf8Decoder.decode(pt);
  });
}

export async function openKdbx(bytes: Uint8Array, password: string, keyFile?: Uint8Array): Promise<XmlNode> {
  const header = readHeader(bytes);
  const compositeKey = buildCompositeKey(password, keyFile);
  const decrypted = header.major >= 4
    ? await decryptV4(bytes, header, compositeKey)
    : await decryptV3(bytes, header, compositeKey);
  const root = parseXml(utf8Decoder.decode(decrypted.xml));
  unprotectValues(root, decrypted.streamId, decrypted.streamKey);
  return root;
}

/* ── Conversion XML ⇄ identifiants ────────────────────────────────────── */

const STANDARD_KEYS = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);
const TOTP_KEYS = ['otp', 'TimeOtp-Secret-Base32', 'TOTP Seed'];
const PASSKEY_PREFIX = 'KPEX_PASSKEY_';
const IGNORED_KEYS = new Set(['TOTP Settings']);

function parseKeePassTime(value: string): number | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  try {
    const b = fromBase64(v);
    if (b.length !== 8) return undefined;
    const seconds = new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, true);
    return (Number(seconds) - KEEPASS_EPOCH_OFFSET_S) * 1000;
  } catch {
    return undefined;
  }
}

function formatKeePassTime(ms: number): string {
  return toBase64(u64le(BigInt(Math.floor(ms / 1000) + KEEPASS_EPOCH_OFFSET_S)));
}

function pemToBase64Url(pem: string): string {
  return pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToPem(value: string): string {
  let b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END PRIVATE KEY-----`;
}

function entryToCredential(entry: XmlNode, groupTags: string[]): Partial<CredentialItem> {
  const strings = new Map<string, { value: string; protected: boolean }>();
  for (const s of children(entry, 'String')) {
    const key = nodeText(child(s, 'Key'));
    const valueNode = child(s, 'Value');
    if (!key) continue;
    strings.set(key, {
      value: valueNode?.text ?? '',
      protected: valueNode?.attrs.Protected === 'True' || valueNode?.attrs.ProtectInMemory === 'True'
    });
  }
  const get = (key: string) => strings.get(key)?.value ?? '';

  const totpRaw = TOTP_KEYS.map(get).find(v => v.trim());
  const totpSecret = totpRaw ? normalizeTotpInput(totpRaw) ?? totpRaw.trim() : undefined;

  const fields: CredentialField[] = [];
  for (const [key, { value, protected: isProtected }] of strings) {
    if (!value || STANDARD_KEYS.has(key) || TOTP_KEYS.includes(key) || IGNORED_KEYS.has(key)
      || key.startsWith(PASSKEY_PREFIX) || key.startsWith('TimeOtp-')) continue;
    fields.push({ id: 'cf-' + Math.random().toString(36).substring(2, 8), label: key, value, isMasked: isProtected });
  }

  const times = child(entry, 'Times');
  const createdAt = parseKeePassTime(nodeText(child(times, 'CreationTime'))) ?? Date.now();
  const updatedAt = parseKeePassTime(nodeText(child(times, 'LastModificationTime'))) ?? createdAt;
  const expires = nodeText(child(times, 'Expires')) === 'True';

  const passkeys: PasskeyData[] = [];
  if (get('KPEX_PASSKEY_RELYING_PARTY') && get('KPEX_PASSKEY_CREDENTIAL_ID')) {
    const pem = get('KPEX_PASSKEY_PRIVATE_KEY_PEM');
    passkeys.push({
      credentialId: get('KPEX_PASSKEY_CREDENTIAL_ID'),
      publicKey: '',
      privateKey: pem ? pemToBase64Url(pem) : undefined,
      signCount: 0,
      rpId: get('KPEX_PASSKEY_RELYING_PARTY'),
      userName: get('KPEX_PASSKEY_USERNAME') || get('UserName'),
      userHandle: get('KPEX_PASSKEY_USER_HANDLE') || undefined,
      createdAt
    });
  }

  const entryTags = nodeText(child(entry, 'Tags')).split(/[;,]/).map(t => t.trim()).filter(Boolean);

  return {
    title: get('Title') || 'Entrée KeePass',
    username: get('UserName'),
    password: get('Password'),
    website: get('URL'),
    notes: get('Notes'),
    totpSecret,
    fields: fields.length ? fields : undefined,
    passkeys: passkeys.length ? passkeys : undefined,
    tags: [...new Set([...groupTags, ...entryTags])],
    expiresAt: expires ? parseKeePassTime(nodeText(child(times, 'ExpiryTime'))) : undefined,
    createdAt,
    updatedAt
  };
}

export function keePassTreeToCredentials(root: XmlNode): Partial<CredentialItem>[] {
  const file = child(root, 'KeePassFile');
  if (!file) throw new KdbxError('Document KeePass XML invalide');

  const meta = child(file, 'Meta');
  const recycleBinUuid = nodeText(child(meta, 'RecycleBinEnabled')) === 'False' ? '' : nodeText(child(meta, 'RecycleBinUUID'));
  const result: Partial<CredentialItem>[] = [];

  const walk = (group: XmlNode, path: string[], isRoot: boolean) => {
    if (recycleBinUuid && nodeText(child(group, 'UUID')) === recycleBinUuid) return;
    const name = nodeText(child(group, 'Name'));
    const tags = isRoot || !name ? path : [...path, name];
    for (const entry of children(group, 'Entry')) result.push(entryToCredential(entry, tags));
    for (const sub of children(group, 'Group')) walk(sub, tags, false);
  };

  for (const group of children(child(file, 'Root'), 'Group')) walk(group, [], true);
  return result;
}

export function parseKeePassXml(xml: string): Partial<CredentialItem>[] {
  return keePassTreeToCredentials(parseXml(xml));
}

export async function parseKdbx(bytes: Uint8Array, password: string, keyFile?: Uint8Array): Promise<Partial<CredentialItem>[]> {
  return keePassTreeToCredentials(await openKdbx(bytes, password, keyFile));
}

/* ── Écriture KDBX 4.0 ────────────────────────────────────────────────── */

export interface KdbxWriteOptions {
  kdf?: 'argon2id' | 'aes';
  aesRounds?: number;
  argon2?: { t: number; m: number; p: number }; // m en KiB
  databaseName?: string;
}

interface KeePassString {
  key: string;
  value: string;
  protect: boolean;
}

function credentialToStrings(cred: CredentialItem): KeePassString[] {
  const strings: KeePassString[] = [
    { key: 'Title', value: cred.title, protect: false },
    { key: 'UserName', value: cred.username, protect: false },
    { key: 'Password', value: cred.password, protect: true },
    { key: 'URL', value: cred.website, protect: false },
    { key: 'Notes', value: cred.notes ?? '', protect: false }
  ];
  const used = new Set(strings.map(s => s.key));
  const add = (key: string, value: string, protect: boolean) => {
    let unique = key;
    for (let n = 2; used.has(unique); n++) unique = `${key} (${n})`;
    used.add(unique);
    strings.push({ key: unique, value, protect });
  };

  if (cred.totpSecret) add('otp', toOtpAuthUri(cred.totpSecret, cred.username, cred.title), true);
  for (const field of cred.fields ?? []) add(field.label, field.value, field.isMasked);

  const passkey = cred.passkeys?.[0];
  if (passkey) {
    add('KPEX_PASSKEY_CREDENTIAL_ID', passkey.credentialId, false);
    add('KPEX_PASSKEY_RELYING_PARTY', passkey.rpId, false);
    add('KPEX_PASSKEY_USERNAME', passkey.userName, false);
    if (passkey.userHandle) add('KPEX_PASSKEY_USER_HANDLE', passkey.userHandle, false);
    if (passkey.privateKey) add('KPEX_PASSKEY_PRIVATE_KEY_PEM', base64UrlToPem(passkey.privateKey), true);
  }
  return strings;
}

function buildKeePassXml(credentials: CredentialItem[], innerKey: Uint8Array, databaseName: string): string {
  const entries = credentials.map(cred => ({ cred, strings: credentialToStrings(cred) }));
  const protectedLength = entries.reduce(
    (n, e) => n + e.strings.filter(s => s.protect).reduce((m, s) => m + utf8.encode(s.value).length, 0),
    0
  );
  const keystream = innerKeystream(3, innerKey, protectedLength);
  let offset = 0;
  const protect = (value: string) => {
    const pt = utf8.encode(value);
    const ct = new Uint8Array(pt.length);
    for (let i = 0; i < pt.length; i++) ct[i] = pt[i] ^ keystream[offset + i];
    offset += pt.length;
    return toBase64(ct);
  };

  const uuid = () => toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const now = formatKeePassTime(Date.now());

  const entriesXml = entries.map(({ cred, strings }) => {
    const stringsXml = strings.map(s =>
      `<String><Key>${encodeXmlText(s.key)}</Key>${s.protect
        ? `<Value Protected="True">${protect(s.value)}</Value>`
        : `<Value>${encodeXmlText(s.value)}</Value>`}</String>`
    ).join('');
    return `<Entry><UUID>${uuid()}</UUID><Tags>${encodeXmlText((cred.tags ?? []).join(';'))}</Tags>`
      + `<Times><CreationTime>${formatKeePassTime(cred.createdAt)}</CreationTime>`
      + `<LastModificationTime>${formatKeePassTime(cred.updatedAt)}</LastModificationTime>`
      + `<LastAccessTime>${now}</LastAccessTime>`
      + `<ExpiryTime>${formatKeePassTime(cred.expiresAt ?? cred.updatedAt)}</ExpiryTime>`
      + `<Expires>${cred.expiresAt ? 'True' : 'False'}</Expires><UsageCount>0</UsageCount>`
      + `<LocationChanged>${now}</LocationChanged></Times>`
      + stringsXml
      + `<AutoType><Enabled>True</Enabled><DataTransferObfuscation>0</DataTransferObfuscation></AutoType><History /></Entry>`;
  }).join('');

  return '<?xml version="1.0" encoding="utf-8" standalone="yes"?>'
    + `<KeePassFile><Meta><Generator>BetterVault</Generator><DatabaseName>${encodeXmlText(databaseName)}</DatabaseName>`
    + `<DatabaseNameChanged>${now}</DatabaseNameChanged><RecycleBinEnabled>False</RecycleBinEnabled></Meta>`
    + `<Root><Group><UUID>${uuid()}</UUID><Name>${encodeXmlText(databaseName)}</Name><IsExpanded>True</IsExpanded>`
    + entriesXml
    + '</Group><DeletedObjects /></Root></KeePassFile>';
}

function hmacBlock(hmacBase: Uint8Array, index: bigint, data: Uint8Array): Uint8Array {
  const size = u32le(data.length);
  const mac = hmac(sha256, blockHmacKey(hmacBase, index), concatBytes(u64le(index), size, data));
  return concatBytes(mac, size, data);
}

export async function buildKdbx4(credentials: CredentialItem[], password: string, options: KdbxWriteOptions = {}): Promise<Uint8Array> {
  if (!password) throw new KdbxError('Un mot de passe est requis pour l’export KeePass');

  const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
  const masterSeed = random(32);
  const iv = random(16);
  const kdfSalt = random(32);
  const innerKey = random(64);
  const argon = options.argon2 ?? { t: 3, m: 65536, p: 2 };

  const kdfParams = options.kdf === 'aes'
    ? buildVariantDictionary([
        ['$UUID', 0x42, fromHex(KDF_AES_KDBX4)],
        ['R', 0x05, BigInt(options.aesRounds ?? 600000)],
        ['S', 0x42, kdfSalt]
      ])
    : buildVariantDictionary([
        ['$UUID', 0x42, fromHex(KDF_ARGON2ID)],
        ['S', 0x42, kdfSalt],
        ['P', 0x04, argon.p],
        ['M', 0x05, BigInt(argon.m * 1024)],
        ['I', 0x05, BigInt(argon.t)],
        ['V', 0x04, 0x13]
      ]);

  const field = (id: number, data: Uint8Array) => concatBytes(new Uint8Array([id]), u32le(data.length), data);
  const header = concatBytes(
    u32le(SIG1), u32le(SIG2), u16le(0), u16le(4),
    field(2, fromHex(CIPHER_AES256)),
    field(3, u32le(1)),
    field(4, masterSeed),
    field(7, iv),
    field(11, kdfParams),
    field(0, utf8.encode('\r\n\r\n'))
  );

  const transformed = await transformKey(readHeader(header), buildCompositeKey(password));
  const hmacBase = sha512(concatBytes(masterSeed, transformed, new Uint8Array([1])));
  const encryptionKey = sha256(concatBytes(masterSeed, transformed));

  const innerHeader = concatBytes(
    new Uint8Array([1]), u32le(4), u32le(3),
    new Uint8Array([2]), u32le(innerKey.length), innerKey,
    new Uint8Array([0]), u32le(0)
  );
  const xml = buildKeePassXml(credentials, innerKey, options.databaseName ?? 'BetterVault');
  const ciphertext = cbc(encryptionKey, iv).encrypt(gzipSync(concatBytes(innerHeader, utf8.encode(xml))));

  return concatBytes(
    header,
    sha256(header),
    hmac(sha256, blockHmacKey(hmacBase, 0xffffffffffffffffn), header),
    hmacBlock(hmacBase, 0n, ciphertext),
    hmacBlock(hmacBase, 1n, new Uint8Array(0))
  );
}
