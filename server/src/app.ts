import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * API BetterVault : le serveur ne stocke que des données chiffrées côté client.
 * Il reçoit une preuve d'authentification dérivée (jamais le mot de passe principal)
 * et la protège à nouveau avec scrypt.
 */

export interface KdfParams {
  t: number;
  m: number;
  p: number;
}

export interface EncryptedBlob {
  v: 1;
  iv: string;
  ct: string;
}

export interface AppOptions {
  db: DatabaseSync;
  serverSecret: string;
  corsOrigins?: string[] | '*';
  sessionTtlMs?: number;
  maxBodyBytes?: number;
  minKdfMemoryKib?: number;
  authRateLimit?: { windowMs: number; max: number };
  /** Derrière un reverse proxy : utiliser X-Forwarded-For pour identifier le client */
  trustProxy?: boolean;
  now?: () => number;
}

interface UserRow {
  id: string;
  email: string;
  auth_verifier: string;
  auth_salt: string;
  kdf: string;
  salt: string;
  wrapped_key: string;
}

interface Reply {
  status: number;
  body?: unknown;
}

export const SERVER_VERSION = '1.0.0';
const DEFAULT_KDF: KdfParams = { t: 3, m: 65536, p: 4 };
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64');

function scryptVerifier(authHash: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(authHash, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function invalid(field: string): HttpError {
  return new HttpError(400, 'invalid_request', `Champ « ${field} » invalide`);
}

function parseBase64(value: unknown, field: string, length: { exact?: number; max?: number }): string {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !BASE64.test(value)) throw invalid(field);
  const size = Buffer.from(value, 'base64').length;
  if ((length.exact !== undefined && size !== length.exact) || (length.max !== undefined && size > length.max)) throw invalid(field);
  return value;
}

function parseEmail(value: unknown): string {
  if (typeof value !== 'string') throw invalid('email');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('email');
  return email;
}

function parseKdf(value: unknown, minMemoryKib: number): KdfParams {
  const kdf = value as Partial<KdfParams> | null;
  const valid = !!kdf && typeof kdf === 'object'
    && Number.isInteger(kdf.t) && kdf.t! >= 1 && kdf.t! <= 10
    && Number.isInteger(kdf.p) && kdf.p! >= 1 && kdf.p! <= 8
    && Number.isInteger(kdf.m) && kdf.m! >= Math.max(minMemoryKib, 8 * kdf.p!) && kdf.m! <= 1048576;
  if (!valid) throw invalid('kdf');
  return { t: kdf.t!, m: kdf.m!, p: kdf.p! };
}

function parseBlob(value: unknown, field: string, maxBytes: number): EncryptedBlob {
  const blob = value as Partial<EncryptedBlob> | null;
  if (!blob || typeof blob !== 'object' || blob.v !== 1) throw invalid(field);
  return { v: 1, iv: parseBase64(blob.iv, `${field}.iv`, { exact: 12 }), ct: parseBase64(blob.ct, `${field}.ct`, { max: maxBytes }) };
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Corps JSON attendu');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'payload_too_large', 'Requête trop volumineuse');
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON invalide');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'invalid_json', 'Objet JSON attendu');
  return parsed as Record<string, unknown>;
}

export function createApp(options: AppOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { db, serverSecret } = options;
  if (serverSecret.length < 32) throw new Error('Le secret serveur doit contenir au moins 32 caractères');

  const now = options.now ?? Date.now;
  const sessionTtl = options.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  const maxBody = options.maxBodyBytes ?? 20 * 1024 * 1024;
  const minKdfMemory = options.minKdfMemoryKib ?? 19456;
  const rateLimit = options.authRateLimit ?? { windowMs: 60_000, max: 20 };
  const corsOrigins = options.corsOrigins ?? '*';
  const dummySalt = randomBytes(16);
  const attempts = new Map<string, { count: number; resetAt: number }>();

  const sql = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, auth_verifier, auth_salt, kdf, salt, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    updateCredentials: db.prepare('UPDATE users SET auth_verifier = ?, auth_salt = ?, kdf = ?, salt = ?, wrapped_key = ? WHERE id = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
    insertVault: db.prepare('INSERT INTO vaults (user_id, revision, blob, updated_at) VALUES (?, ?, ?, ?)'),
    vaultByUser: db.prepare('SELECT revision, blob, updated_at FROM vaults WHERE user_id = ?'),
    updateVault: db.prepare('UPDATE vaults SET revision = ?, blob = ?, updated_at = ? WHERE user_id = ? AND revision = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    sessionByHash: db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
  };

  const clientAddress = (req: IncomingMessage) => {
    const forwarded = options.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    return forwarded || req.socket.remoteAddress || 'unknown';
  };

  const limit = (req: IncomingMessage, bucket: string) => {
    const key = `${bucket}:${clientAddress(req)}`;
    const current = now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= current) {
      if (attempts.size > 10_000) attempts.clear();
      attempts.set(key, { count: 1, resetAt: current + rateLimit.windowMs });
      return;
    }
    entry.count++;
    if (entry.count > rateLimit.max) {
      throw new HttpError(429, 'rate_limited', 'Trop de tentatives, réessayez dans une minute');
    }
  };

  const createSession = (userId: string) => {
    const token = randomBytes(32).toString('base64url');
    sql.insertSession.run(sha256(token), userId, now(), now() + sessionTtl);
    return token;
  };

  const authenticate = (req: IncomingMessage): { userId: string; tokenHash: string } => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
    if (!match) throw new HttpError(401, 'unauthorized', 'Session requise');
    const tokenHash = sha256(match[1]);
    const session = sql.sessionByHash.get(tokenHash) as { user_id: string; expires_at: number } | undefined;
    if (!session || session.expires_at <= now()) throw new HttpError(401, 'unauthorized', 'Session expirée');
    return { userId: session.user_id, tokenHash };
  };

  const verifyAuthHash = async (user: UserRow | undefined, authHash: string): Promise<boolean> => {
    const computed = await scryptVerifier(authHash, user ? Buffer.from(user.auth_salt, 'base64') : dummySalt);
    const expected = user ? Buffer.from(user.auth_verifier, 'base64') : randomBytes(32);
    return !!user && timingSafeEqual(computed, expected);
  };

  const readVault = (userId: string) => {
    const row = sql.vaultByUser.get(userId) as { revision: number; blob: string; updated_at: number } | undefined;
    return row
      ? { revision: row.revision, blob: JSON.parse(row.blob) as EncryptedBlob, updatedAt: row.updated_at }
      : { revision: 0, blob: null, updatedAt: null };
  };

  const routes: Record<string, (req: IncomingMessage) => Promise<Reply>> = {
    'GET /api/v1/health': async () => ({ status: 200, body: { ok: true, name: 'BetterVault', version: SERVER_VERSION } }),

    'POST /api/v1/sessions/prelogin': async req => {
      limit(req, 'prelogin');
      const email = parseEmail((await readJson(req, 4096)).email);
      const user = sql.userByEmail.get(email) as UserRow | undefined;
      if (user) return { status: 200, body: { kdf: JSON.parse(user.kdf), salt: user.salt } };
      // Compte inconnu : réponse stable et crédible pour ne pas révéler l'existence des comptes
      const salt = createHmac('sha256', serverSecret).update(`prelogin:${email}`).digest().subarray(0, 16).toString('base64');
      return { status: 200, body: { kdf: DEFAULT_KDF, salt } };
    },

    'POST /api/v1/accounts': async req => {
      limit(req, 'register');
      const body = await readJson(req, maxBody);
      const email = parseEmail(body.email);
      const authHash = parseBase64(body.authHash, 'authHash', { exact: 32 });
      const kdf = parseKdf(body.kdf, minKdfMemory);
      const salt = parseBase64(body.salt, 'salt', { exact: 16 });
      const wrappedVaultKey = parseBlob(body.wrappedVaultKey, 'wrappedVaultKey', 64);
      const vault = parseBlob(body.vault, 'vault', maxBody);

      if (sql.userByEmail.get(email)) throw new HttpError(409, 'email_taken', 'Un compte existe déjà pour cet email');

      const userId = randomUUID();
      const authSalt = randomBytes(16);
      const verifier = await scryptVerifier(authHash, authSalt);
      const createdAt = now();

      db.exec('BEGIN IMMEDIATE');
      try {
        sql.insertUser.run(userId, email, verifier.toString('base64'), authSalt.toString('base64'), JSON.stringify(kdf), salt, JSON.stringify(wrappedVaultKey), createdAt);
        sql.insertVault.run(userId, 1, JSON.stringify(vault), createdAt);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        if (String(err).includes('UNIQUE')) throw new HttpError(409, 'email_taken', 'Un compte existe déjà pour cet email');
        throw err;
      }

      return { status: 201, body: { token: createSession(userId), revision: 1 } };
    },

    'POST /api/v1/sessions': async req => {
      limit(req, 'login');
      const body = await readJson(req, 4096);
      const email = parseEmail(body.email);
      const authHash = parseBase64(body.authHash, 'authHash', { exact: 32 });
      const user = sql.userByEmail.get(email) as UserRow | undefined;

      if (!(await verifyAuthHash(user, authHash)) || !user) {
        throw new HttpError(401, 'invalid_credentials', 'Email ou mot de passe incorrect');
      }

      sql.deleteExpiredSessions.run(now());
      return {
        status: 200,
        body: { token: createSession(user.id), wrappedVaultKey: JSON.parse(user.wrapped_key), kdf: JSON.parse(user.kdf), salt: user.salt }
      };
    },

    'DELETE /api/v1/sessions': async req => {
      const { tokenHash } = authenticate(req);
      sql.deleteSession.run(tokenHash);
      return { status: 204 };
    },

    'GET /api/v1/vault': async req => {
      const { userId } = authenticate(req);
      return { status: 200, body: readVault(userId) };
    },

    'PUT /api/v1/vault': async req => {
      const { userId } = authenticate(req);
      const body = await readJson(req, maxBody);
      const baseRevision = body.baseRevision;
      if (!Number.isInteger(baseRevision) || (baseRevision as number) < 0) throw invalid('baseRevision');
      const blob = parseBlob(body.blob, 'blob', maxBody);
      const updatedAt = now();

      // Écriture conditionnelle : échoue si un autre appareil a publié entre-temps
      const result = sql.updateVault.run((baseRevision as number) + 1, JSON.stringify(blob), updatedAt, userId, baseRevision as number);
      if (Number(result.changes) === 0) {
        throw new HttpError(409, 'conflict', 'Le coffre a été modifié sur un autre appareil', readVault(userId));
      }
      return { status: 200, body: { revision: (baseRevision as number) + 1, updatedAt } };
    },

    'PUT /api/v1/accounts/password': async req => {
      const { userId, tokenHash } = authenticate(req);
      limit(req, 'password');
      const body = await readJson(req, 4096);
      const currentAuthHash = parseBase64(body.currentAuthHash, 'currentAuthHash', { exact: 32 });
      const newAuthHash = parseBase64(body.newAuthHash, 'newAuthHash', { exact: 32 });
      const kdf = parseKdf(body.kdf, minKdfMemory);
      const salt = parseBase64(body.salt, 'salt', { exact: 16 });
      const wrappedVaultKey = parseBlob(body.wrappedVaultKey, 'wrappedVaultKey', 64);

      const user = sql.userById.get(userId) as UserRow | undefined;
      if (!(await verifyAuthHash(user, currentAuthHash))) throw new HttpError(403, 'invalid_credentials', 'Mot de passe principal actuel incorrect');

      const authSalt = randomBytes(16);
      const verifier = await scryptVerifier(newAuthHash, authSalt);
      sql.updateCredentials.run(verifier.toString('base64'), authSalt.toString('base64'), JSON.stringify(kdf), salt, JSON.stringify(wrappedVaultKey), userId);
      // Les autres appareils devront se reconnecter avec le nouveau mot de passe
      sql.deleteOtherSessions.run(userId, tokenHash);
      return { status: 204 };
    },

    'DELETE /api/v1/accounts': async req => {
      const { userId } = authenticate(req);
      limit(req, 'delete');
      const authHash = parseBase64((await readJson(req, 4096)).authHash, 'authHash', { exact: 32 });
      const user = sql.userById.get(userId) as UserRow | undefined;
      if (!(await verifyAuthHash(user, authHash))) throw new HttpError(403, 'invalid_credentials', 'Mot de passe incorrect');
      sql.deleteUser.run(userId);
      return { status: 204 };
    }
  };

  const applyHeaders = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (corsOrigins === '*') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  };

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    if (body === undefined) {
      res.writeHead(status).end();
      return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  };

  return async (req, res) => {
    applyHeaders(req, res);
    if (req.method === 'OPTIONS') {
      send(res, 204);
      return;
    }
    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      const route = routes[`${req.method} ${pathname}`];
      if (!route) throw new HttpError(404, 'not_found', 'Route inconnue');
      const reply = await route(req);
      send(res, reply.status, reply.body);
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: { code: err.code, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) } });
      } else {
        console.error(err);
        send(res, 500, { error: { code: 'internal', message: 'Erreur interne du serveur' } });
      }
    }
  };
}
