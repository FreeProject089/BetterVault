import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError, readJson, type Reply } from './http.ts';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.ts';

/**
 * Comptes administrateurs et rôles.
 *
 * Rôles
 *   viewer   : consulter le tableau de bord, le journal, l'état des nœuds et sauvegardes ;
 *   operator : en plus, lancer une synchronisation, une sauvegarde, un test ;
 *   owner    : tout, dont les réglages, la confiance entre nœuds, les secrets, les
 *              restaurations et la gestion des administrateurs.
 *
 * Actions sensibles
 *   Révoquer, supprimer, restaurer, changer la confiance ou un secret demandent une
 *   reconfirmation récente (mot de passe, et code 2FA s'il est activé) : une session
 *   restée ouverte sur un poste ne suffit pas.
 *
 * Accès de secours
 *   ADMIN_TOKEN reste accepté, avec les droits d'un propriétaire : il crée le premier
 *   compte, et dépanne si tous les comptes sont perdus. Une fois des comptes créés, le
 *   tableau de bord recommande de le désactiver (ADMIN_TOKEN=disabled).
 */

export type AdminRole = 'viewer' | 'operator' | 'owner';
export type AdminPermission = 'view' | 'operate' | 'manage';

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  viewer: ['view'],
  operator: ['view', 'operate'],
  owner: ['view', 'operate', 'manage']
};

export const isAdminRole = (value: unknown): value is AdminRole => value === 'viewer' || value === 'operator' || value === 'owner';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REAUTH_TTL_MS = 5 * 60 * 1000;
const TOKEN_PREFIX = 'bvadm_';
const MIN_PASSWORD = 12;

export interface AdminIdentity {
  id: string;
  email: string;
  role: AdminRole;
  /** Accès de secours par ADMIN_TOKEN */
  breakGlass: boolean;
  /** Reconfirmé depuis moins de cinq minutes */
  recentlyConfirmed: boolean;
}

interface AdminRow {
  id: string;
  email: string;
  role: AdminRole;
  password_hash: string;
  password_salt: string;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number;
  created_at: number;
  disabled_at: number | null;
  last_login_at: number | null;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64');

function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // N = 2^15 : quelques dizaines de millisecondes, assez pour ralentir un essai massif
    scrypt(password.normalize('NFKC'), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export function installAdminSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      totp_last_step INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      disabled_at INTEGER,
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      confirmed_at INTEGER NOT NULL
    );
  `);
}

export function createAdminAuth(options: {
  db: DatabaseSync;
  /** Empreinte de ADMIN_TOKEN, ou null s'il est désactivé */
  breakGlassHash: string | null;
  now: () => number;
  limit: (req: IncomingMessage, bucket: string) => void;
  /** Refuse si le plafond est déjà atteint, sans compter la requête */
  blocked: (req: IncomingMessage, bucket: string) => void;
  audit: (type: string, detail?: Record<string, unknown>) => void;
}) {
  const { db, now, audit } = options;
  installAdminSchema(db);

  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM admin_users WHERE disabled_at IS NULL').get() as { n: number }).n;
  const byEmail = (email: string) => db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email) as AdminRow | undefined;
  const byId = (id: string) => db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id) as AdminRow | undefined;

  /** L'administration existe si un jeton de secours ou au moins un compte actif existe */
  const enabled = () => !!options.breakGlassHash || count() > 0;

  function identify(req: IncomingMessage): AdminIdentity | null {
    const match = /^Bearer (.{16,200})$/.exec(String(req.headers.authorization ?? ''));
    if (!match) return null;
    const presented = match[1];

    if (presented.startsWith(TOKEN_PREFIX)) {
      const row = db.prepare(`
        SELECT s.confirmed_at, u.* FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`).get(sha256(presented), now()) as (AdminRow & { confirmed_at: number }) | undefined;
      if (!row || !isAdminRole(row.role)) return null;
      return { id: row.id, email: row.email, role: row.role, breakGlass: false, recentlyConfirmed: now() - row.confirmed_at < REAUTH_TTL_MS };
    }

    if (!options.breakGlassHash) return null;
    const provided = Buffer.from(sha256(presented), 'base64');
    const expected = Buffer.from(options.breakGlassHash, 'base64');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    return { id: 'break-glass', email: 'ADMIN_TOKEN', role: 'owner', breakGlass: true, recentlyConfirmed: true };
  }

  /**
   * Vérifie l'accès. `sensitive` exige une reconfirmation récente : l'erreur
   * `reauth_required` indique à la page de redemander le mot de passe.
   */
  function require(req: IncomingMessage, permission: AdminPermission, sensitive = false): AdminIdentity {
    /*
     * Deux compteurs : un plafond large pour l'usage normal (chaque écran de
     * l'administration fait plusieurs appels), et un plafond serré pour les
     * échecs seulement. Avant, les deux étaient confondus : on se faisait
     * bloquer rien qu'en naviguant, sans rendre un essai de jeton plus lent.
     */
    options.limit(req, 'admin');
    options.blocked(req, 'admin-fail');
    if (!enabled()) throw new HttpError(404, 'not_found', 'Route inconnue');
    const identity = identify(req);
    if (!identity) {
      options.limit(req, 'admin-fail');
      throw new HttpError(401, 'unauthorized', 'Jeton d’administration incorrect');
    }
    if (!ROLE_PERMISSIONS[identity.role].includes(permission)) {
      throw new HttpError(403, 'forbidden', 'Votre rôle ne permet pas cette action');
    }
    if (sensitive && !identity.recentlyConfirmed) {
      throw new HttpError(403, 'reauth_required', 'Confirmez votre mot de passe pour cette action');
    }
    return identity;
  }

  const verifyPassword = async (row: AdminRow, password: string) => {
    const hash = await hashPassword(password, Buffer.from(row.password_salt, 'base64'));
    return timingSafeEqual(hash, Buffer.from(row.password_hash, 'base64'));
  };

  /** Travail constant : un email inconnu coûte autant qu'un mot de passe faux */
  const dummySalt = randomBytes(16);
  const checkCredentials = async (email: string, password: string, totp: unknown): Promise<AdminRow> => {
    const row = byEmail(email);
    const ok = row ? await verifyPassword(row, password) : (await hashPassword(password, dummySalt), false);
    if (!row || !ok || row.disabled_at !== null) throw new HttpError(401, 'invalid_credentials', 'Email ou mot de passe incorrect');
    if (row.totp_enabled && row.totp_secret) {
      if (typeof totp !== 'string' || !/^\d{6}$/.test(totp)) throw new HttpError(401, 'totp_required', 'Code de l’application d’authentification requis');
      const step = verifyTotp(row.totp_secret, totp, now(), row.totp_last_step);
      if (step === null) throw new HttpError(401, 'totp_invalid', 'Code incorrect ou déjà utilisé');
      db.prepare('UPDATE admin_users SET totp_last_step = ? WHERE id = ?').run(step, row.id);
    }
    return row;
  };

  const parseEmail = (value: unknown) => {
    const email = String(value ?? '').trim().toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'invalid_email', 'Adresse email invalide');
    return email;
  };
  const parsePassword = (value: unknown) => {
    const password = String(value ?? '');
    if (password.length < MIN_PASSWORD || password.length > 1024) {
      throw new HttpError(400, 'weak_password', `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères`);
    }
    return password;
  };

  const publicRow = (row: AdminRow) => ({
    id: row.id, email: row.email, role: row.role, totpEnabled: !!row.totp_enabled,
    createdAt: row.created_at, lastLoginAt: row.last_login_at, disabled: row.disabled_at !== null
  });

  const routes: Record<string, (req: IncomingMessage) => Promise<Reply>> = {
    'POST /api/v1/admin/login': async req => {
      options.limit(req, 'admin-login');
      if (!enabled()) throw new HttpError(404, 'not_found', 'Route inconnue');
      const body = await readJson(req, 4096);
      const row = await checkCredentials(parseEmail(body.email), String(body.password ?? ''), body.totp);
      const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO admin_sessions (token_hash, admin_id, created_at, expires_at, confirmed_at) VALUES (?, ?, ?, ?, ?)')
        .run(sha256(token), row.id, now(), now() + SESSION_TTL_MS, now());
      db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(now(), row.id);
      audit('admin.login', { admin: row.id });
      return { status: 200, body: { token, admin: publicRow(row) } };
    },

    'POST /api/v1/admin/logout': async req => {
      const match = /^Bearer (bvadm_.{16,200})$/.exec(String(req.headers.authorization ?? ''));
      if (match) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(match[1]));
      return { status: 204 };
    },

    'GET /api/v1/admin/me': async req => {
      const me = require(req, 'view');
      return {
        status: 200,
        body: {
          ...(me.breakGlass ? { id: me.id, email: me.email, role: me.role, totpEnabled: false } : publicRow(byId(me.id)!)),
          breakGlass: me.breakGlass,
          accounts: count(),
          // Tant que le jeton de secours reste actif alors que des comptes existent, on le signale
          breakGlassActive: !!options.breakGlassHash
        }
      };
    },

    /** Reconfirmation avant une action sensible */
    'POST /api/v1/admin/reauth': async req => {
      const me = require(req, 'view');
      if (me.breakGlass) return { status: 204 };
      const body = await readJson(req, 4096);
      await checkCredentials(me.email, String(body.password ?? ''), body.totp);
      const match = /^Bearer (bvadm_.{16,200})$/.exec(String(req.headers.authorization ?? ''))!;
      db.prepare('UPDATE admin_sessions SET confirmed_at = ? WHERE token_hash = ?').run(now(), sha256(match[1]));
      return { status: 204 };
    },

    'GET /api/v1/admin/accounts': async req => {
      require(req, 'manage');
      const rows = db.prepare('SELECT * FROM admin_users ORDER BY created_at').all() as unknown as AdminRow[];
      return { status: 200, body: { accounts: rows.map(publicRow) } };
    },

    'POST /api/v1/admin/accounts': async req => {
      const me = require(req, 'manage', true);
      const body = await readJson(req, 4096);
      const email = parseEmail(body.email);
      const password = parsePassword(body.password);
      if (!isAdminRole(body.role)) throw new HttpError(400, 'invalid_role', 'Rôle inconnu');
      if (byEmail(email)) throw new HttpError(409, 'email_taken', 'Un administrateur existe déjà pour cet email');
      const salt = randomBytes(16);
      const id = `adm-${randomBytes(9).toString('hex')}`;
      db.prepare('INSERT INTO admin_users (id, email, role, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, email, body.role, (await hashPassword(password, salt)).toString('base64'), salt.toString('base64'), now());
      audit('admin.account_created', { by: me.id, admin: id, role: body.role });
      return { status: 201, body: publicRow(byId(id)!) };
    },

    'POST /api/v1/admin/password': async req => {
      const me = require(req, 'view', true);
      if (me.breakGlass) throw new HttpError(400, 'break_glass', 'Le jeton de secours n’a pas de mot de passe');
      const password = parsePassword((await readJson(req, 4096)).password);
      const salt = randomBytes(16);
      db.prepare('UPDATE admin_users SET password_hash = ?, password_salt = ? WHERE id = ?')
        .run((await hashPassword(password, salt)).toString('base64'), salt.toString('base64'), me.id);
      // Les autres sessions de ce compte sont fermées : le mot de passe a pu fuiter
      const current = /^Bearer (bvadm_.{16,200})$/.exec(String(req.headers.authorization ?? ''))![1];
      db.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash <> ?').run(me.id, sha256(current));
      audit('admin.password_changed', { admin: me.id });
      return { status: 204 };
    },

    'POST /api/v1/admin/totp/setup': async req => {
      const me = require(req, 'view', true);
      if (me.breakGlass) throw new HttpError(400, 'break_glass', 'Le jeton de secours n’a pas de double authentification');
      const secret = generateTotpSecret();
      db.prepare('UPDATE admin_users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, me.id);
      return { status: 200, body: { secret, uri: otpauthUri(secret, me.email, 'BetterVault admin') } };
    },

    'POST /api/v1/admin/totp/enable': async req => {
      const me = require(req, 'view', true);
      const row = byId(me.id);
      const code = String((await readJson(req, 1024)).code ?? '');
      if (!row?.totp_secret) throw new HttpError(400, 'totp_not_setup', 'Configurez d’abord la double authentification');
      const step = verifyTotp(row.totp_secret, code, now(), 0);
      if (step === null) throw new HttpError(400, 'totp_invalid', 'Code incorrect ou déjà utilisé');
      db.prepare('UPDATE admin_users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?').run(step, me.id);
      audit('admin.totp_enabled', { admin: me.id });
      return { status: 204 };
    }
  };

  /** Modification d'un compte : rôle, désactivation, suppression */
  async function updateAccount(req: IncomingMessage, id: string, method: 'PATCH' | 'DELETE'): Promise<Reply> {
    const me = require(req, 'manage', true);
    const target = byId(id);
    if (!target) throw new HttpError(404, 'not_found', 'Administrateur inconnu');
    const owners = () => (db.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'owner' AND disabled_at IS NULL").get() as { n: number }).n;
    const isLastOwner = target.role === 'owner' && target.disabled_at === null && owners() <= 1;

    if (method === 'DELETE') {
      // Sans propriétaire actif, plus personne ne pourrait administrer (sauf jeton de secours)
      if (isLastOwner) throw new HttpError(409, 'last_owner', 'Impossible de supprimer le dernier propriétaire');
      db.prepare('DELETE FROM admin_users WHERE id = ?').run(id);
      audit('admin.account_deleted', { by: me.id, admin: id });
      return { status: 204 };
    }

    const body = await readJson(req, 4096);
    if (body.role !== undefined) {
      if (!isAdminRole(body.role)) throw new HttpError(400, 'invalid_role', 'Rôle inconnu');
      if (isLastOwner && body.role !== 'owner') throw new HttpError(409, 'last_owner', 'Il faut au moins un propriétaire');
      db.prepare('UPDATE admin_users SET role = ? WHERE id = ?').run(body.role, id);
      audit('admin.role_changed', { by: me.id, admin: id, role: body.role });
    }
    if (typeof body.disabled === 'boolean') {
      if (body.disabled && isLastOwner) throw new HttpError(409, 'last_owner', 'Impossible de désactiver le dernier propriétaire');
      db.prepare('UPDATE admin_users SET disabled_at = ? WHERE id = ?').run(body.disabled ? now() : null, id);
      if (body.disabled) db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(id);
      audit(body.disabled ? 'admin.account_disabled' : 'admin.account_enabled', { by: me.id, admin: id });
    }
    if (body.resetTotp === true) {
      db.prepare('UPDATE admin_users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(id);
      audit('admin.totp_reset', { by: me.id, admin: id });
    }
    return { status: 200, body: publicRow(byId(id)!) };
  }

  return { require, identify, enabled, routes, updateAccount };
}

export type AdminAuth = ReturnType<typeof createAdminAuth>;
