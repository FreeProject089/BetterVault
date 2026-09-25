import { argon2idAsync } from '@noble/hashes/argon2.js';
import { blake2b } from '@noble/hashes/blake2.js';

/**
 * Sauvegarde chiffrée de Passky (passky.org) : `{"encrypted": true, "passwords": [...]}`.
 *
 * Chaque champ (site, identifiant, mot de passe, note) est chiffré par la
 * bibliothèque XChaCha20-JS de Passky, avec une clé tirée du compte Passky :
 *
 *   clé = Argon2id(Blake2b(nom + "-" + mot de passe + "-passky2020"),
 *                  sel Blake2b(nom + "-passky2020"), t = 32, m = 32 Kio, p = 4, 64 octets)
 *
 * en hexadécimal, le nom d'utilisateur en minuscules (comme à la connexion Passky).
 *
 * Cette bibliothèque n'est pas du XChaCha20 standard, et un XChaCha20 ordinaire
 * ne relit pas ces fichiers. Reproduit ici à l'identique, sans son code :
 *   - les octets de la clé sont les codes des caractères de la clé hexadécimale,
 *     écrits en hexadécimal puis relus comme des nombres décimaux (« 61 » → 61,
 *     « 3a » → 0) ;
 *   - dans les mots 6, 8 et 9 de l'état, un octet de clé est remplacé par une
 *     constante (9, 18 et 22) ;
 *   - le chiffré compte un élément de plus que le texte (un octet du flux), suivi
 *     du nonce de 24 octets ; le tout passe en texte, en UTF-8, puis en base64.
 * Aucune authentification : un mauvais mot de passe donne du texte illisible,
 * reconnu ensuite (UTF-8 invalide ou caractères de contrôle).
 */

const SIGMA = [1634760805, 857760878, 2036477234, 1797285236];

/** Conversion d'un opérande JavaScript en entier 32 bits, comme le fait « ^ » ou « << » */
const int32 = (v: unknown): number => Number(v) | 0;
const le32 = (a: unknown, b: unknown, c: unknown, d: unknown) => (int32(a) ^ (int32(b) << 8) ^ (int32(c) << 16) ^ (int32(d) << 24)) >>> 0;

const rotl = (v: number, n: number) => (v << n) | (v >>> (32 - n));
function quarter(s: Uint32Array, a: number, b: number, c: number, d: number) {
  s[a] += s[b]; s[d] ^= s[a]; s[d] = rotl(s[d], 16);
  s[c] += s[d]; s[b] ^= s[c]; s[b] = rotl(s[b], 12);
  s[a] += s[b]; s[d] ^= s[a]; s[d] = rotl(s[d], 8);
  s[c] += s[d]; s[b] ^= s[c]; s[b] = rotl(s[b], 7);
}
function rounds(s: Uint32Array) {
  for (let i = 0; i < 10; i++) {
    quarter(s, 0, 4, 8, 12); quarter(s, 1, 5, 9, 13); quarter(s, 2, 6, 10, 14); quarter(s, 3, 7, 11, 15);
    quarter(s, 0, 5, 10, 15); quarter(s, 1, 6, 11, 12); quarter(s, 2, 7, 8, 13); quarter(s, 3, 4, 9, 14);
  }
}

/** Mots 4 à 11 de l'état, avec les trois octets remplacés par une constante */
const keyWords = (k: ArrayLike<unknown>) => [
  le32(k[0], k[1], k[2], k[3]), le32(k[4], k[5], k[6], k[7]), le32(k[8], 9, k[10], k[11]), le32(k[12], k[13], k[14], k[15]),
  le32(k[16], k[17], 18, k[19]), le32(k[20], k[21], 22, k[23]), le32(k[24], k[25], k[26], k[27]), le32(k[28], k[29], k[30], k[31])
];

function hchacha(key: ArrayLike<unknown>, nonce: ArrayLike<number>): number[] {
  const s = new Uint32Array([...SIGMA, ...keyWords(key),
    le32(nonce[0], nonce[1], nonce[2], nonce[3]), le32(nonce[4], nonce[5], nonce[6], nonce[7]),
    le32(nonce[8], nonce[9], nonce[10], nonce[11]), le32(nonce[12], nonce[13], nonce[14], nonce[15])]);
  rounds(s);
  const out: number[] = [];
  for (const w of [s[0], s[1], s[2], s[3], s[12], s[13], s[14], s[15]]) out.push(w & 255, (w >>> 8) & 255, (w >>> 16) & 255, (w >>> 24) & 255);
  return out;
}

function block(key: number[], nonce: number[], counter: number): number[] {
  const input = [...SIGMA, ...keyWords(key), counter >>> 0,
    le32(nonce[0], nonce[1], nonce[2], nonce[3]), le32(nonce[4], nonce[5], nonce[6], nonce[7]), le32(nonce[8], nonce[9], nonce[10], nonce[11])];
  const s = new Uint32Array(input);
  rounds(s);
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    const w = (input[i] + s[i]) >>> 0;
    out.push(w & 255, (w >>> 8) & 255, (w >>> 16) & 255, (w >>> 24) & 255);
  }
  return out;
}

/** Codes des caractères d'une clé, tels que XChaCha20-JS les passe à son état */
const keyOperands = (key: string) => Array.from(key, ch => ch.charCodeAt(0).toString(16));

/** Chiffré Passky → suite des codes de caractères (base64, puis UTF-8, comme b64DecodeUnicode) */
function codesOf(cipher: string): number[] {
  const binary = atob(cipher);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
}

/** Déchiffre un champ ; lève une erreur si le texte n'a pas la forme d'un chiffré Passky */
export function passkyDecryptField(cipher: string, key: string): string {
  if (!cipher) return '';
  const data = codesOf(cipher);
  if (data.length < 25) throw new Error('Champ Passky trop court');
  const nonce = data.slice(-24);
  const body = data.slice(0, -24);
  const subkey = hchacha(keyOperands(key), nonce.slice(0, 16));
  const n12 = [0, 0, 0, 0, ...nonce.slice(16, 24)];
  let stream: number[] = [];
  for (let counter = 0; stream.length < body.length; counter++) stream = stream.concat(block(subkey, n12, counter));
  /*
   * Texte d'une longueur multiple de 64 : XChaCha20-JS n'avait plus d'octet de
   * flux pour l'élément en trop, qui vaut alors 0 (et Passky relit ce texte
   * avec un caractère parasite). On le retire tel quel, au lieu de le déchiffrer.
   */
  const last = body.length - 1;
  if (last > 0 && last % 64 === 0 && body[last] === 0) return String.fromCharCode(...body.slice(0, last).map((c, i) => c ^ stream[i]));
  const plain = body.map((c, i) => c ^ stream[i]);
  // Le dernier élément, en trop, redevient 0 : le premier NUL est retiré, comme chez Passky
  return String.fromCharCode(...plain).replace('\0', '');
}

/** Chiffre comme XChaCha20-JS (sert aux tests : aller-retour et exemples) */
export function passkyEncryptField(plain: string, key: string, nonce: Uint8Array = crypto.getRandomValues(new Uint8Array(24))): string {
  const codes = Array.from({ length: plain.length }, (_, i) => plain.charCodeAt(i));
  const subkey = hchacha(keyOperands(key), Array.from(nonce.slice(0, 16)));
  const n12 = [0, 0, 0, 0, ...Array.from(nonce.slice(16, 24))];
  // Autant de blocs que le texte en demande (un au moins), comme XChaCha20-JS
  let stream: number[] = [];
  for (let counter = 0; stream.length < Math.max(codes.length, 1); counter++) stream = stream.concat(block(subkey, n12, counter));
  // Un élément de plus que le texte : undefined ^ octet = octet du flux (0 s'il n'y en a plus)
  const out = [...codes.map((c, i) => c ^ stream[i]), stream[codes.length] ?? 0, ...nonce];
  const text = String.fromCharCode(...out);
  const bytes = new TextEncoder().encode(text);
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
}

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const utf8 = (text: string) => new TextEncoder().encode(text);

/** Clé des champs, à partir du compte Passky (lente : Argon2id, 32 passes) */
export async function passkyKey(username: string, password: string): Promise<string> {
  const user = username.trim().toLowerCase();
  const message = hex(blake2b(utf8(`${user}-${password}-passky2020`)));
  const salt = hex(blake2b(utf8(`${user}-passky2020`)));
  return hex(await argon2idAsync(utf8(message), utf8(salt), { t: 32, m: 32, p: 4, dkLen: 64 }));
}

export interface PasskyEntry { website: string; username: string; password: string; message: string }

export function isPasskyEncrypted(json: unknown): json is { encrypted: true; passwords: Array<Record<string, unknown>> } {
  const j = json as { encrypted?: unknown; passwords?: unknown } | null;
  return !!j && j.encrypted === true && Array.isArray(j.passwords)
    && j.passwords.every(p => !!p && typeof p === 'object' && 'website' in p && 'password' in p);
}

/** Texte déchiffré vraisemblable : pas de caractère de contrôle hors tabulation et retours à la ligne */
const plausible = (text: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f�]/.test(text);

/**
 * Déchiffre toute la sauvegarde. Un mauvais nom ou mot de passe ne se voit pas
 * à coup sûr (pas d'authentification) : il donne du texte illisible, et le
 * premier champ qui n'a pas l'air d'un texte fait échouer l'ensemble.
 */
export async function decryptPasskyBackup(json: { passwords: Array<Record<string, unknown>> }, username: string, password: string): Promise<PasskyEntry[]> {
  const key = await passkyKey(username, password);
  return json.passwords.map(entry => {
    const out = {} as PasskyEntry;
    for (const field of ['website', 'username', 'password', 'message'] as const) {
      let clear: string;
      try {
        clear = passkyDecryptField(String(entry[field] ?? ''), key);
      } catch {
        throw new PasskyWrongCredentialsError();
      }
      if (!plausible(clear)) throw new PasskyWrongCredentialsError();
      out[field] = clear;
    }
    return out;
  });
}

export class PasskyWrongCredentialsError extends Error {
  constructor() {
    super('Sauvegarde Passky : nom d’utilisateur ou mot de passe incorrect');
    this.name = 'PasskyWrongCredentialsError';
  }
}
