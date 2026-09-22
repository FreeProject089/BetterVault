import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './http.ts';

/**
 * Clés de sécurité matérielles (WebAuthn) en second facteur.
 *
 * Le serveur ne s'appuie sur aucune bibliothèque : il lit lui-même l'objet
 * d'attestation (CBOR), la clé publique (COSE) et vérifie les signatures avec
 * node:crypto. L'attestation n'est pas vérifiée (« none ») : ajouter une clé
 * demande déjà une session ouverte et le mot de passe principal, ce qui suffit à
 * prouver que c'est le titulaire qui l'ajoute.
 *
 * Une clé est liée au domaine (rpId) de l'application qui l'a enregistrée : web,
 * bureau et extension ont chacun le leur. À la connexion, seules les clés du
 * domaine appelant sont proposées ; l'application d'authentification reste l'autre
 * moyen, pour les surfaces où aucune clé n'a été enregistrée.
 */

const CHALLENGE_TTL_MS = 2 * 60_000;
const MAX_KEYS = 10;

/* ── CBOR minimal (ce qu'utilisent l'attestation et les clés COSE) ─────── */

type Cbor = number | bigint | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | boolean | null | undefined;

export function decodeCbor(bytes: Uint8Array): { value: Cbor; length: number } {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (n: number) => {
    if (pos + n > bytes.length) throw new Error('CBOR tronqué');
  };
  const readLength = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) { need(1); return bytes[pos++]; }
    if (info === 25) { need(2); const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { need(4); const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) {
      need(8);
      const v = view.getBigUint64(pos);
      pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR : entier trop grand');
      return Number(v);
    }
    throw new Error('CBOR : longueur indéfinie non prise en charge');
  };
  const item = (depth: number): Cbor => {
    if (depth > 16) throw new Error('CBOR trop imbriqué');
    need(1);
    const head = bytes[pos++];
    const major = head >> 5;
    const info = head & 31;
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return undefined;
      throw new Error('CBOR : valeur simple non prise en charge');
    }
    const len = readLength(info);
    switch (major) {
      case 0: return len;
      case 1: return -1 - len;
      case 2: { need(len); const v = bytes.slice(pos, pos + len); pos += len; return v; }
      case 3: { need(len); const v = new TextDecoder().decode(bytes.subarray(pos, pos + len)); pos += len; return v; }
      case 4: {
        if (len > 1024) throw new Error('CBOR : tableau trop long');
        return Array.from({ length: len }, () => item(depth + 1));
      }
      case 5: {
        if (len > 1024) throw new Error('CBOR : table trop longue');
        const map = new Map<Cbor, Cbor>();
        for (let i = 0; i < len; i++) {
          const key = item(depth + 1);
          map.set(key, item(depth + 1));
        }
        return map;
      }
      default: throw new Error('CBOR : type non pris en charge');
    }
  };
  const value = item(0);
  return { value, length: pos };
}

/* ── Données d'authentificateur et clé COSE ───────────────────────────── */

export interface AuthenticatorData {
  rpIdHash: Buffer;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
  credentialId?: Buffer;
  publicKey?: Map<Cbor, Cbor>;
}

export function parseAuthenticatorData(data: Buffer): AuthenticatorData {
  if (data.length < 37) throw new Error('Données d’authentificateur trop courtes');
  const flags = data[32];
  const parsed: AuthenticatorData = {
    rpIdHash: data.subarray(0, 32),
    userPresent: !!(flags & 0x01),
    userVerified: !!(flags & 0x04),
    signCount: data.readUInt32BE(33)
  };
  if (flags & 0x40) {
    if (data.length < 55) throw new Error('Données de clé absentes');
    const idLength = data.readUInt16BE(53);
    if (idLength > 1023 || data.length < 55 + idLength) throw new Error('Identifiant de clé invalide');
    parsed.credentialId = data.subarray(55, 55 + idLength);
    const cose = decodeCbor(data.subarray(55 + idLength));
    if (!(cose.value instanceof Map)) throw new Error('Clé COSE invalide');
    parsed.publicKey = cose.value;
  }
  return parsed;
}

const b64url = (buf: Uint8Array) => Buffer.from(buf).toString('base64url');

/** Algorithmes acceptés : ES256, EdDSA (Ed25519) et RS256 */
export function coseToKey(cose: Map<Cbor, Cbor>): { key: KeyObject; alg: number } {
  const kty = cose.get(1);
  const alg = cose.get(3);
  const bytes = (label: number) => {
    const v = cose.get(label);
    if (!(v instanceof Uint8Array)) throw new Error('Clé COSE incomplète');
    return v;
  };
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    return { alg: -7, key: createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64url(bytes(-2)), y: b64url(bytes(-3)) } }) };
  }
  if (kty === 1 && alg === -8 && cose.get(-1) === 6) {
    return { alg: -8, key: createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: b64url(bytes(-2)) } }) };
  }
  if (kty === 3 && alg === -257) {
    return { alg: -257, key: createPublicKey({ format: 'jwk', key: { kty: 'RSA', n: b64url(bytes(-1)), e: b64url(bytes(-2)) } }) };
  }
  throw new Error('Type de clé non pris en charge');
}

export function verifySignature(key: KeyObject, alg: number, data: Buffer, signature: Buffer): boolean {
  try {
    return verify(alg === -8 ? null : 'sha256', data, key, signature);
  } catch {
    return false;
  }
}

/* ── Contrôles communs aux deux cérémonies ────────────────────────────── */

const RP_ID = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

export function parseRpId(value: unknown): string {
  const rpId = String(value ?? '').toLowerCase();
  if (!RP_ID.test(rpId)) throw new HttpError(400, 'invalid_rp_id', 'Domaine de l’application invalide');
  return rpId;
}

/** L'origine doit appartenir au domaine annoncé, et être sûre (https, ou locale, ou d'extension) */
export function originMatches(origin: string, rpId: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host !== rpId && !host.endsWith(`.${rpId}`)) return false;
  if (url.protocol === 'https:' || url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:' || url.protocol === 'tauri:') return true;
  return url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost'));
}

interface ClientData { type: string; challenge: string; origin: string }

function checkClientData(json: Buffer, type: string, challenge: string, rpId: string): void {
  let data: ClientData;
  try {
    data = JSON.parse(json.toString('utf8')) as ClientData;
  } catch {
    throw new HttpError(400, 'webauthn_invalid', 'Réponse de la clé illisible');
  }
  if (data.type !== type) throw new HttpError(400, 'webauthn_invalid', 'Réponse de la clé inattendue');
  if (data.challenge !== challenge) throw new HttpError(400, 'webauthn_invalid', 'Défi expiré ou différent : recommencez');
  if (typeof data.origin !== 'string' || !originMatches(data.origin, rpId)) throw new HttpError(400, 'webauthn_origin', 'La clé a répondu pour une autre application');
}

const decode = (value: unknown, field: string, max = 4096): Buffer => {
  if (typeof value !== 'string' || !value || value.length > max * 2) throw new HttpError(400, 'invalid_request', `${field} invalide`);
  return Buffer.from(value, 'base64url');
};

/* ── Stockage et cérémonies ───────────────────────────────────────────── */

export interface SecurityKeyRow {
  id: string;
  user_id: string;
  name: string;
  rp_id: string;
  public_key: string;
  alg: number;
  sign_count: number;
  created_at: number;
  last_used_at: number | null;
}

export interface AssertionInput {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

export function installWebauthnSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      alg INTEGER NOT NULL,
      sign_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS security_keys_user ON security_keys(user_id);
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      challenge TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
}

export function createWebauthn(db: DatabaseSync, now: () => number) {
  installWebauthnSchema(db);
  const sql = {
    keys: db.prepare('SELECT * FROM security_keys WHERE user_id = ? ORDER BY created_at'),
    key: db.prepare('SELECT * FROM security_keys WHERE id = ? AND user_id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM security_keys WHERE user_id = ?'),
    insert: db.prepare('INSERT INTO security_keys (id, user_id, name, rp_id, public_key, alg, sign_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    remove: db.prepare('DELETE FROM security_keys WHERE id = ? AND user_id = ?'),
    use: db.prepare('UPDATE security_keys SET sign_count = ?, last_used_at = ? WHERE id = ? AND sign_count = ?'),
    purge: db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?'),
    addChallenge: db.prepare('INSERT INTO webauthn_challenges (challenge, user_id, purpose, rp_id, expires_at) VALUES (?, ?, ?, ?, ?)'),
    takeChallenge: db.prepare('DELETE FROM webauthn_challenges WHERE challenge = ? AND user_id = ? AND purpose = ? AND rp_id = ? AND expires_at >= ? RETURNING challenge')
  };

  const issue = (userId: string, purpose: 'register' | 'login', rpId: string): string => {
    sql.purge.run(now());
    const challenge = randomBytes(32).toString('base64url');
    sql.addChallenge.run(challenge, userId, purpose, rpId, now() + CHALLENGE_TTL_MS);
    return challenge;
  };
  /** Un défi ne sert qu'une fois, même si la vérification échoue ensuite */
  const take = (userId: string, purpose: string, rpId: string, challenge: string) => {
    if (!sql.takeChallenge.get(challenge, userId, purpose, rpId, now())) {
      throw new HttpError(400, 'webauthn_invalid', 'Défi expiré ou différent : recommencez');
    }
  };
  const challengeOf = (clientDataJSON: Buffer): string => {
    try {
      return String((JSON.parse(clientDataJSON.toString('utf8')) as ClientData).challenge ?? '');
    } catch {
      return '';
    }
  };

  const rpHash = (rpId: string) => createHash('sha256').update(rpId).digest();

  return {
    keysFor: (userId: string) => sql.keys.all(userId) as unknown as SecurityKeyRow[],

    list: (userId: string) => (sql.keys.all(userId) as unknown as SecurityKeyRow[])
      .map(k => ({ id: k.id, name: k.name, rpId: k.rp_id, createdAt: k.created_at, lastUsedAt: k.last_used_at })),

    registrationOptions(userId: string, email: string, rpId: string) {
      if (Number((sql.count.get(userId) as { n: number }).n) >= MAX_KEYS) {
        throw new HttpError(409, 'too_many_keys', `${MAX_KEYS} clés de sécurité au plus`);
      }
      return {
        challenge: issue(userId, 'register', rpId),
        rp: { id: rpId, name: 'BetterVault' },
        user: { id: Buffer.from(userId).toString('base64url'), name: email, displayName: email },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
        excludeCredentials: (sql.keys.all(userId) as unknown as SecurityKeyRow[]).filter(k => k.rp_id === rpId).map(k => ({ type: 'public-key', id: k.id })),
        timeout: CHALLENGE_TTL_MS
      };
    },

    register(userId: string, input: { name: unknown; rpId: unknown; clientDataJSON: unknown; attestationObject: unknown }) {
      const rpId = parseRpId(input.rpId);
      const name = String(input.name ?? '').trim().slice(0, 40) || 'Clé de sécurité';
      const clientDataJSON = decode(input.clientDataJSON, 'clientDataJSON');
      const challenge = challengeOf(clientDataJSON);
      take(userId, 'register', rpId, challenge);
      checkClientData(clientDataJSON, 'webauthn.create', challenge, rpId);

      let authData: AuthenticatorData;
      try {
        const attestation = decodeCbor(decode(input.attestationObject, 'attestationObject', 16384)).value;
        const raw = attestation instanceof Map ? attestation.get('authData') : null;
        if (!(raw instanceof Uint8Array)) throw new Error('authData absent');
        authData = parseAuthenticatorData(Buffer.from(raw));
      } catch (err) {
        throw new HttpError(400, 'webauthn_invalid', err instanceof Error ? err.message : 'Attestation illisible');
      }
      if (!authData.rpIdHash.equals(rpHash(rpId))) throw new HttpError(400, 'webauthn_origin', 'La clé a répondu pour une autre application');
      if (!authData.userPresent) throw new HttpError(400, 'webauthn_invalid', 'Touchez la clé pour confirmer');
      if (!authData.credentialId || !authData.publicKey) throw new HttpError(400, 'webauthn_invalid', 'La clé n’a pas fourni de clé publique');

      let key: { key: KeyObject; alg: number };
      try {
        key = coseToKey(authData.publicKey);
      } catch (err) {
        throw new HttpError(400, 'webauthn_unsupported', err instanceof Error ? err.message : 'Clé non prise en charge');
      }
      const id = b64url(authData.credentialId);
      const spki = key.key.export({ format: 'der', type: 'spki' }).toString('base64');
      try {
        sql.insert.run(id, userId, name, rpId, spki, key.alg, authData.signCount, now());
      } catch {
        throw new HttpError(409, 'key_exists', 'Cette clé est déjà enregistrée');
      }
      return { id, name, rpId, createdAt: now(), lastUsedAt: null };
    },

    remove(userId: string, id: string): boolean {
      return Number(sql.remove.run(id, userId).changes) === 1;
    },

    /** Options de connexion, ou null si aucune clé n'est enregistrée pour ce domaine */
    loginOptions(userId: string, rpId: string) {
      const keys = (sql.keys.all(userId) as unknown as SecurityKeyRow[]).filter(k => k.rp_id === rpId);
      if (!keys.length) return null;
      return {
        challenge: issue(userId, 'login', rpId),
        rpId,
        allowCredentials: keys.map(k => ({ type: 'public-key', id: k.id })),
        userVerification: 'discouraged',
        timeout: CHALLENGE_TTL_MS
      };
    },

    verifyLogin(userId: string, rpIdInput: unknown, input: AssertionInput | undefined): void {
      const rpId = parseRpId(rpIdInput);
      if (!input || typeof input !== 'object') throw new HttpError(400, 'webauthn_invalid', 'Réponse de la clé absente');
      const clientDataJSON = decode(input.clientDataJSON, 'clientDataJSON');
      const challenge = challengeOf(clientDataJSON);
      take(userId, 'login', rpId, challenge);
      checkClientData(clientDataJSON, 'webauthn.get', challenge, rpId);

      const row = sql.key.get(String(input.id ?? ''), userId) as SecurityKeyRow | undefined;
      if (!row || row.rp_id !== rpId) throw new HttpError(401, 'webauthn_invalid', 'Clé de sécurité inconnue pour ce compte');
      const authenticatorData = decode(input.authenticatorData, 'authenticatorData');
      const signature = decode(input.signature, 'signature');
      const auth = parseAuthenticatorData(authenticatorData);
      if (!auth.rpIdHash.equals(rpHash(rpId))) throw new HttpError(401, 'webauthn_origin', 'La clé a répondu pour une autre application');
      if (!auth.userPresent) throw new HttpError(401, 'webauthn_invalid', 'Touchez la clé pour confirmer');

      const key = createPublicKey({ key: Buffer.from(row.public_key, 'base64'), format: 'der', type: 'spki' });
      const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
      if (!verifySignature(key, row.alg, signed, signature)) throw new HttpError(401, 'webauthn_invalid', 'Signature de la clé invalide');

      // Un compteur qui recule trahit une clé clonée ; 0 veut dire « pas de compteur »
      if ((auth.signCount !== 0 || row.sign_count !== 0) && auth.signCount <= row.sign_count) {
        throw new HttpError(401, 'webauthn_cloned', 'Cette clé semble avoir été copiée : elle est refusée');
      }
      if (Number(sql.use.run(auth.signCount, now(), row.id, row.sign_count).changes) !== 1) {
        throw new HttpError(401, 'webauthn_invalid', 'Clé déjà utilisée à l’instant : recommencez');
      }
    }
  };
}

export type Webauthn = ReturnType<typeof createWebauthn>;
