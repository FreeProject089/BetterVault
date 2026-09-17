import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { avatarInfo, avatarRoutes, DEFAULT_AVATARS } from './avatars.ts';
import { localizeMessage, requestLocale } from './messages.ts';
import {
  HttpError,
  invalid,
  parseBase64,
  parseBlob,
  parseCode,
  parseEmail,
  parseKdf,
  parseRecovery,
  readJson,
  scryptVerifier,
  sha256,
  type EncryptedBlob,
  type KdfParams,
  type RecoveryMaterial,
  type Reply
} from './http.ts';
import type { PatternRoute, RouteContext } from './context.ts';
import { accountKeyRoutes, sharingRoutes } from './sharing.ts';
import { attachmentRoutes, deleteUserAttachments } from './attachments.ts';
import { databaseSnapshot, encryptBackup, type BackupService, type BackupSettings } from './backup.ts';
import { sessionRoutes } from './sessions.ts';
import { billingRoutes, createLimitsResolver } from './billing.ts';
import { LEGAL_DOCUMENTS, legalConfigured, legalTitle, renderLegalPage } from './legal.ts';
import { analytics, createAudit, type Metrics } from './metrics.ts';
import { describeUserAgent, truncateIp, type GeoLookup } from './geoip.ts';
import { route } from './context.ts';
import type { DatabaseSync } from 'node:sqlite';
import { parseSettingsUpdate, publicSettings, settingsFromEnv, type ServerSettings } from './config.ts';
import { createSmtpMailer, type Mailer, type MailMessage, type SmtpConfig } from './mailer.ts';
import { emails, pickLocale, type Locale } from './emails.ts';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.ts';

/**
 * API BetterVault : le serveur ne stocke que des données chiffrées côté client.
 * Il reçoit une preuve d'authentification dérivée (jamais le mot de passe principal)
 * et la protège à nouveau avec scrypt.
 */

export type { EncryptedBlob, KdfParams } from './http.ts';

export interface AppOptions {
  db: DatabaseSync;
  serverSecret: string;
  corsOrigins?: string[] | '*';
  sessionTtlMs?: number;
  minKdfMemoryKib?: number;
  authRateLimit?: { windowMs: number; max: number };
  /** Derrière un reverse proxy : utiliser X-Forwarded-For pour identifier le client */
  trustProxy?: boolean;
  /** Réglages initiaux (.env) ; ceux enregistrés depuis la page d'administration les remplacent */
  settings?: ServerSettings;
  /** Empreinte SHA-256 (base64) du jeton d'administration ; sans elle, l'API d'administration est désactivée */
  adminTokenHash?: string | null;
  mailerFactory?: (smtp: SmtpConfig) => Mailer;
  /** Dossier des pièces jointes chiffrées ; sans lui, les pièces jointes sont désactivées */
  filesDir?: string | null;
  /** Service de sauvegarde, construit avec l'accès aux réglages courants */
  backupFactory?: (settings: () => BackupSettings) => BackupService;
  /** Base de localisation locale (lieu approximatif des sessions) */
  geo?: GeoLookup | null;
  metrics?: Metrics | null;
  /** Chemin du fichier SQLite, pour la taille affichée dans le tableau de bord */
  dbPath?: string | null;
  /** Dossier des modèles de documents légaux */
  legalDir?: string;
  /** Appels HTTP sortants (Stripe) ; remplaçable dans les tests */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface UserRow {
  id: string;
  email: string;
  auth_verifier: string;
  auth_salt: string;
  kdf: string;
  salt: string;
  wrapped_key: string;
  created_at: number;
  locale: string | null;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number;
  recovery_verifier: string | null;
  recovery_salt: string | null;
  recovery_wrapped_key: string | null;
  public_key: string | null;
  wrapped_private_key: string | null;
}

export const SERVER_VERSION = '1.1.0';
const DEFAULT_KDF: KdfParams = { t: 3, m: 65536, p: 4 };
const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
const RECOVERY_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_EMAIL_CODE_ATTEMPTS = 5;

export function createApp(options: AppOptions): ((req: IncomingMessage, res: ServerResponse) => Promise<void>) & { close(): void } {
  const { db, serverSecret } = options;
  if (serverSecret.length < 32) throw new Error('Le secret serveur doit contenir au moins 32 caractères');

  const now = options.now ?? Date.now;
  const sessionTtl = options.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  const minKdfMemory = options.minKdfMemoryKib ?? 19456;
  const rateLimit = options.authRateLimit ?? { windowMs: 60_000, max: 20 };
  const corsOrigins = options.corsOrigins ?? '*';
  const mailerFactory = options.mailerFactory ?? createSmtpMailer;
  const dummySalt = randomBytes(16);
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const audit = createAudit(db, serverSecret, now);
  const fetchImpl = options.fetchImpl ?? fetch;

  const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const writeSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  let settings: ServerSettings = options.settings ?? settingsFromEnv({});
  const saved = readSetting.get('settings') as { value: string } | undefined;
  if (saved) {
    try {
      settings = parseSettingsUpdate(JSON.parse(saved.value), settings);
    } catch (err) {
      console.error('Réglages enregistrés ignorés :', err);
    }
  }

  const limitsFor = createLimitsResolver(db, () => settings, now);
  const geoAvailable = () => (options.geo ? options.geo.available?.() ?? true : false);

  // Le coffre est transmis en base64 dans du JSON : marge de 40 % et quelques Ko pour l'enveloppe
  const maxBody = () => Math.ceil(settings.limits.maxVaultBytes * 1.4) + 64 * 1024;
  const maxBodyFor = (userId: string) => Math.ceil(limitsFor(userId).maxVaultBytes * 1.4) + 64 * 1024;

  const sql = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare(`INSERT INTO users (id, email, auth_verifier, auth_salt, kdf, salt, wrapped_key, created_at, locale, recovery_verifier, recovery_salt, recovery_wrapped_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    updateCredentials: db.prepare('UPDATE users SET auth_verifier = ?, auth_salt = ?, kdf = ?, salt = ?, wrapped_key = ? WHERE id = ?'),
    updateRecovery: db.prepare('UPDATE users SET recovery_verifier = ?, recovery_salt = ?, recovery_wrapped_key = ? WHERE id = ?'),
    updateLocale: db.prepare('UPDATE users SET locale = ? WHERE id = ?'),
    setTotpSecret: db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_step = 0 WHERE id = ?'),
    enableTotp: db.prepare('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?'),
    disableTotp: db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?'),
    useTotpStep: db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
    deleteAllSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    insertVault: db.prepare('INSERT INTO vaults (user_id, revision, blob, updated_at) VALUES (?, ?, ?, ?)'),
    vaultByUser: db.prepare('SELECT revision, blob, updated_at FROM vaults WHERE user_id = ?'),
    updateVault: db.prepare('UPDATE vaults SET revision = ?, blob = ?, updated_at = ? WHERE user_id = ? AND revision = ?'),
    replaceVault: db.prepare('UPDATE vaults SET revision = revision + 1, blob = ?, updated_at = ? WHERE user_id = ?'),
    insertSession: db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, public_id, device, ip_prefix, country, city, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    sessionByHash: db.prepare('SELECT user_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    upsertEmailCode: db.prepare(`INSERT INTO email_codes (user_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
      ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`),
    emailCodeByUser: db.prepare('SELECT code_hash, expires_at, attempts FROM email_codes WHERE user_id = ?'),
    bumpEmailCode: db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = ?'),
    deleteEmailCode: db.prepare('DELETE FROM email_codes WHERE user_id = ?'),
    insertRecoveryToken: db.prepare('INSERT INTO recovery_tokens (token_hash, user_id, with_recovery_key, expires_at) VALUES (?, ?, ?, ?)'),
    recoveryToken: db.prepare('SELECT user_id, with_recovery_key, expires_at FROM recovery_tokens WHERE token_hash = ?'),
    deleteRecoveryTokens: db.prepare('DELETE FROM recovery_tokens WHERE user_id = ?'),
    countUsers: db.prepare('SELECT COUNT(*) AS count FROM users'),
    vaultBytes: db.prepare('SELECT COALESCE(SUM(LENGTH(blob)), 0) AS bytes FROM vaults'),
    twoFactorUsers: db.prepare('SELECT COUNT(*) AS count FROM users WHERE totp_enabled = 1')
  };

  /*
   * Adresse du client derrière un reverse proxy.
   *
   * Un proxy AJOUTE l'adresse qu'il constate à la fin de « X-Forwarded-For ». Tout
   * ce qui est à gauche a donc été écrit par le client lui-même : prendre le premier
   * maillon revient à laisser l'appelant choisir son identité. On retient le
   * dernier, le seul écrit par le hop de confiance.
   */
  const clientAddress = (req: IncomingMessage) => {
    const chain = options.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',') : [];
    const forwarded = chain.length ? chain[chain.length - 1].trim() : '';
    return forwarded || req.socket.remoteAddress || 'unknown';
  };

  const limit = (req: IncomingMessage, bucket: string) => {
    const key = `${bucket}:${clientAddress(req)}`;
    const current = now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= current) {
      // Purge des entrées expirées plutôt qu'un vidage total : vider remettrait à
      // zéro les compteurs de tout le monde, ce qui se provoque facilement.
      if (attempts.size > 10_000) {
        for (const [existing, value] of attempts) {
          if (value.resetAt <= current) attempts.delete(existing);
        }
        if (attempts.size > 20_000) attempts.clear();
      }
      attempts.set(key, { count: 1, resetAt: current + rateLimit.windowMs });
      return;
    }
    entry.count++;
    if (entry.count > rateLimit.max) {
      throw new HttpError(429, 'rate_limited', 'Trop de tentatives, réessayez dans une minute');
    }
  };

  /** Lieu approximatif et appareil : l'adresse IP complète n'est jamais enregistrée */
  const describeClient = (req: IncomingMessage) => {
    const ip = clientAddress(req);
    const place = options.geo?.lookup(ip) ?? null;
    return { ipPrefix: truncateIp(ip), country: place?.country ?? null, city: place?.city ?? null, device: describeUserAgent(String(req.headers['user-agent'] ?? '')) };
  };

  const createSession = (userId: string, req: IncomingMessage) => {
    const token = randomBytes(32).toString('base64url');
    const client = describeClient(req);
    sql.insertSession.run(sha256(token), userId, now(), now() + sessionTtl, randomBytes(8).toString('hex'), client.device, client.ipPrefix, client.country, client.city, now());
    return token;
  };

  const authenticate = (req: IncomingMessage): { userId: string; tokenHash: string } => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
    if (!match) throw new HttpError(401, 'unauthorized', 'Session requise');
    const tokenHash = sha256(match[1]);
    const session = sql.sessionByHash.get(tokenHash) as { user_id: string; expires_at: number; last_seen_at: number | null } | undefined;
    if (!session || session.expires_at <= now()) throw new HttpError(401, 'unauthorized', 'Session expirée');
    // Dernière activité à 5 minutes près : évite une écriture à chaque requête
    if (!session.last_seen_at || now() - session.last_seen_at > 300_000) sql.touchSession.run(now(), tokenHash);
    return { userId: session.user_id, tokenHash };
  };

  const getUser = (userId: string): UserRow => {
    const user = sql.userById.get(userId) as UserRow | undefined;
    if (!user) throw new HttpError(401, 'unauthorized', 'Compte introuvable');
    return user;
  };

  const verifyAuthHash = async (user: UserRow | undefined, authHash: string): Promise<boolean> => {
    const computed = await scryptVerifier(authHash, user ? Buffer.from(user.auth_salt, 'base64') : dummySalt);
    const expected = user ? Buffer.from(user.auth_verifier, 'base64') : randomBytes(32);
    return !!user && timingSafeEqual(computed, expected);
  };

  const verifyRecoveryHash = async (user: UserRow | undefined, authHash: string): Promise<boolean> => {
    const hasRecovery = !!user?.recovery_verifier && !!user.recovery_salt;
    const computed = await scryptVerifier(authHash, hasRecovery ? Buffer.from(user!.recovery_salt!, 'base64') : dummySalt);
    const expected = hasRecovery ? Buffer.from(user!.recovery_verifier!, 'base64') : randomBytes(32);
    return hasRecovery && timingSafeEqual(computed, expected);
  };

  /** Consomme un code de l'application d'authentification (un code ne sert qu'une fois) */
  const consumeTotp = (user: UserRow, code: string | null): boolean => {
    if (!user.totp_secret || !code) return false;
    const step = verifyTotp(user.totp_secret, code, now(), user.totp_last_step);
    if (step === null) return false;
    return Number(sql.useTotpStep.run(step, user.id, step).changes) === 1;
  };

  const recoveryColumns = async (recovery: RecoveryMaterial | null): Promise<[string | null, string | null, string | null]> => {
    if (!recovery) return [null, null, null];
    const salt = randomBytes(16);
    const verifier = await scryptVerifier(recovery.authHash, salt);
    return [verifier.toString('base64'), salt.toString('base64'), JSON.stringify(recovery.wrappedVaultKey)];
  };

  const readVault = (userId: string) => {
    const row = sql.vaultByUser.get(userId) as { revision: number; blob: string; updated_at: number } | undefined;
    return row
      ? { revision: row.revision, blob: JSON.parse(row.blob) as EncryptedBlob, updatedAt: row.updated_at }
      : { revision: 0, blob: null, updatedAt: null };
  };

  const locale = (user: UserRow): Locale => (user.locale === 'fr' || user.locale === 'en' ? user.locale : 'en');

  /** Envoi en arrière-plan : une panne du serveur SMTP ne bloque jamais l'utilisateur */
  const notify = (build: (ctx: { to: string; locale: Locale; publicUrl: string }) => MailMessage, user: UserRow) => {
    if (!settings.smtp) return;
    const message = build({ to: user.email, locale: locale(user), publicUrl: settings.publicUrl });
    mailerFactory(settings.smtp).send(message).catch(err => console.error(`Email non envoyé à ${user.email} :`, err instanceof Error ? err.message : err));
  };

  const requireAdmin = (req: IncomingMessage) => {
    limit(req, 'admin');
    if (!options.adminTokenHash) throw new HttpError(404, 'not_found', 'Route inconnue');
    const match = /^Bearer (.{16,200})$/.exec(req.headers.authorization ?? '');
    const provided = Buffer.from(match ? sha256(match[1]) : '', 'base64');
    const expected = Buffer.from(options.adminTokenHash, 'base64');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new HttpError(401, 'unauthorized', 'Jeton d’administration incorrect');
    }
  };

  const emailCodeHash = (userId: string, code: string) => createHmac('sha256', serverSecret).update(`email-code:${userId}:${code}`).digest('base64');

  const routes: Record<string, (req: IncomingMessage) => Promise<Reply>> = {
    'GET /api/v1/health': async () => ({ status: 200, body: { ok: true, name: 'BetterVault', version: SERVER_VERSION } }),

    'GET /api/v1/config': async () => ({
      status: 200,
      body: {
        version: SERVER_VERSION,
        limits: settings.limits,
        registrationOpen: settings.registrationOpen,
        emailEnabled: !!settings.smtp,
        avatars: { ...(settings.avatars ?? DEFAULT_AVATARS), maxBytes: settings.limits.maxAvatarBytes }
      }
    }),

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
      if (!settings.registrationOpen) throw new HttpError(403, 'registration_closed', 'Les inscriptions sont fermées sur ce serveur');
      const body = await readJson(req, maxBody());
      const email = parseEmail(body.email);
      const authHash = parseBase64(body.authHash, 'authHash', { exact: 32 });
      const kdf = parseKdf(body.kdf, minKdfMemory);
      const salt = parseBase64(body.salt, 'salt', { exact: 16 });
      const wrappedVaultKey = parseBlob(body.wrappedVaultKey, 'wrappedVaultKey', 64);
      const vault = parseBlob(body.vault, 'vault', settings.limits.maxVaultBytes);
      const recovery = parseRecovery(body.recovery);

      if (sql.userByEmail.get(email)) throw new HttpError(409, 'email_taken', 'Un compte existe déjà pour cet email');

      const userId = randomUUID();
      const authSalt = randomBytes(16);
      const verifier = await scryptVerifier(authHash, authSalt);
      const [recoveryVerifier, recoverySalt, recoveryWrapped] = await recoveryColumns(recovery);
      const createdAt = now();

      db.exec('BEGIN IMMEDIATE');
      try {
        sql.insertUser.run(userId, email, verifier.toString('base64'), authSalt.toString('base64'), JSON.stringify(kdf), salt, JSON.stringify(wrappedVaultKey), createdAt,
          pickLocale(body.locale, req.headers['accept-language']), recoveryVerifier, recoverySalt, recoveryWrapped);
        sql.insertVault.run(userId, 1, JSON.stringify(vault), createdAt);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        if (String(err).includes('UNIQUE')) throw new HttpError(409, 'email_taken', 'Un compte existe déjà pour cet email');
        throw err;
      }

      audit('account.created', {}, userId);
      return { status: 201, body: { token: createSession(userId, req), revision: 1 } };
    },

    'POST /api/v1/sessions': async req => {
      limit(req, 'login');
      const body = await readJson(req, 4096);
      const email = parseEmail(body.email);
      const authHash = parseBase64(body.authHash, 'authHash', { exact: 32 });
      const totp = parseCode(body.totp, 'totp');
      const user = sql.userByEmail.get(email) as UserRow | undefined;

      if (!(await verifyAuthHash(user, authHash)) || !user) {
        throw new HttpError(401, 'invalid_credentials', 'Email ou mot de passe incorrect');
      }
      if (user.totp_enabled) {
        if (!totp) throw new HttpError(401, 'totp_required', 'Code de l’application d’authentification requis');
        if (!consumeTotp(user, totp)) throw new HttpError(401, 'totp_invalid', 'Code incorrect ou déjà utilisé');
      }

      if (body.locale === 'fr' || body.locale === 'en') sql.updateLocale.run(body.locale, user.id);
      sql.deleteExpiredSessions.run(now());
      if (body.notify !== false) {
        const client = describeClient(req);
        const place = [client.city, client.country].filter(Boolean).join(', ');
        notify(ctx => emails.newLogin(ctx, now(), `${client.ipPrefix}${place ? ` (${place})` : ''}`, client.device), user);
      }
      return {
        status: 200,
        body: { token: createSession(user.id, req), wrappedVaultKey: JSON.parse(user.wrapped_key), kdf: JSON.parse(user.kdf), salt: user.salt }
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
      const maxVaultBytes = limitsFor(userId).maxVaultBytes;
      const body = await readJson(req, maxBodyFor(userId));
      const baseRevision = body.baseRevision;
      if (!Number.isInteger(baseRevision) || (baseRevision as number) < 0) throw invalid('baseRevision');
      let blob: EncryptedBlob;
      try {
        blob = parseBlob(body.blob, 'blob', maxVaultBytes);
      } catch (err) {
        if (err instanceof HttpError && Buffer.byteLength(String((body.blob as EncryptedBlob | undefined)?.ct ?? ''), 'base64') > maxVaultBytes) {
          throw new HttpError(413, 'vault_too_large', `Le coffre dépasse la taille autorisée (${Math.round(maxVaultBytes / 1048576)} Mo)`);
        }
        throw err;
      }
      const updatedAt = now();

      // Écriture conditionnelle : échoue si un autre appareil a publié entre-temps
      const result = sql.updateVault.run((baseRevision as number) + 1, JSON.stringify(blob), updatedAt, userId, baseRevision as number);
      if (Number(result.changes) === 0) {
        throw new HttpError(409, 'conflict', 'Le coffre a été modifié sur un autre appareil', readVault(userId));
      }
      return { status: 200, body: { revision: (baseRevision as number) + 1, updatedAt } };
    },

    'GET /api/v1/accounts/me': async req => {
      const user = getUser(authenticate(req).userId);
      return {
        status: 200,
        body: {
          email: user.email,
          createdAt: user.created_at,
          totpEnabled: !!user.totp_enabled,
          hasRecoveryKey: !!user.recovery_verifier,
          emailEnabled: !!settings.smtp,
          limits: limitsFor(user.id),
          avatar: avatarInfo(context, user.id)
        }
      };
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

      const user = getUser(userId);
      if (!(await verifyAuthHash(user, currentAuthHash))) throw new HttpError(403, 'invalid_credentials', 'Mot de passe principal actuel incorrect');

      const authSalt = randomBytes(16);
      const verifier = await scryptVerifier(newAuthHash, authSalt);
      sql.updateCredentials.run(verifier.toString('base64'), authSalt.toString('base64'), JSON.stringify(kdf), salt, JSON.stringify(wrappedVaultKey), userId);
      // Les autres appareils devront se reconnecter avec le nouveau mot de passe
      sql.deleteOtherSessions.run(userId, tokenHash);
      notify(ctx => emails.passwordChanged(ctx, now(), false), user);
      audit('account.password_changed', {}, userId);
      return { status: 204 };
    },

    'PUT /api/v1/accounts/recovery': async req => {
      const { userId } = authenticate(req);
      limit(req, 'password');
      const body = await readJson(req, 4096);
      const authHash = parseBase64(body.authHash, 'authHash', { exact: 32 });
      const recovery = parseRecovery(body.recovery);
      if (!recovery) throw invalid('recovery');
      const user = getUser(userId);
      if (!(await verifyAuthHash(user, authHash))) throw new HttpError(403, 'invalid_credentials', 'Mot de passe principal incorrect');
      const [verifier, salt, wrapped] = await recoveryColumns(recovery);
      sql.updateRecovery.run(verifier, salt, wrapped, userId);
      sql.deleteRecoveryTokens.run(userId);
      notify(ctx => emails.recoveryKeyChanged(ctx, now()), user);
      return { status: 204 };
    },

    'POST /api/v1/accounts/2fa/setup': async req => {
      const { userId } = authenticate(req);
      limit(req, 'password');
      const authHash = parseBase64((await readJson(req, 4096)).authHash, 'authHash', { exact: 32 });
      const user = getUser(userId);
      if (!(await verifyAuthHash(user, authHash))) throw new HttpError(403, 'invalid_credentials', 'Mot de passe principal incorrect');
      if (user.totp_enabled) throw new HttpError(409, 'totp_already_enabled', 'La double authentification est déjà activée');
      const secret = generateTotpSecret();
      sql.setTotpSecret.run(secret, userId);
      return { status: 200, body: { secret, uri: otpauthUri(secret, user.email, 'BetterVault') } };
    },

    'POST /api/v1/accounts/2fa/enable': async req => {
      const { userId } = authenticate(req);
      limit(req, 'password');
      const code = parseCode((await readJson(req, 4096)).code, 'code');
      const user = getUser(userId);
      if (user.totp_enabled) throw new HttpError(409, 'totp_already_enabled', 'La double authentification est déjà activée');
      if (!user.totp_secret) throw new HttpError(400, 'totp_not_setup', 'Recommencez la configuration de la double authentification');
      const step = code ? verifyTotp(user.totp_secret, code, now(), 0) : null;
      if (step === null) throw new HttpError(400, 'totp_invalid', 'Code incorrect. Vérifiez l’heure de votre téléphone.');
      sql.enableTotp.run(step, userId);
      notify(ctx => emails.twoFactor(ctx, now(), true), user);
      audit('account.2fa_enabled', {}, userId);
      return { status: 204 };
    },

    'DELETE /api/v1/accounts/2fa': async req => {
      const { userId } = authenticate(req);
      limit(req, 'password');
      const body = await readJson(req, 4096);
      const authHash = parseBase64(body.authHash, 'authHash', { exact: 32 });
      const code = parseCode(body.code, 'code');
      const user = getUser(userId);
      if (!(await verifyAuthHash(user, authHash))) throw new HttpError(403, 'invalid_credentials', 'Mot de passe principal incorrect');
      if (user.totp_enabled && !consumeTotp(user, code)) throw new HttpError(400, 'totp_invalid', 'Code incorrect ou déjà utilisé');
      sql.disableTotp.run(userId);
      if (user.totp_enabled) notify(ctx => emails.twoFactor(ctx, now(), false), user);
      audit('account.2fa_disabled', {}, userId);
      return { status: 204 };
    },

    'DELETE /api/v1/accounts': async req => {
      const { userId } = authenticate(req);
      limit(req, 'delete');
      const authHash = parseBase64((await readJson(req, 4096)).authHash, 'authHash', { exact: 32 });
      const user = sql.userById.get(userId) as UserRow | undefined;
      if (!(await verifyAuthHash(user, authHash))) throw new HttpError(403, 'invalid_credentials', 'Mot de passe incorrect');
      deleteUserAttachments(context, userId);
      sql.deleteUser.run(userId);
      audit('account.deleted', {}, userId);
      return { status: 204 };
    },

    /* ── Mot de passe oublié ──────────────────────────────────────────── */

    'POST /api/v1/recovery/start': async req => {
      limit(req, 'recovery');
      const body = await readJson(req, 4096);
      const email = parseEmail(body.email);
      const user = sql.userByEmail.get(email) as UserRow | undefined;
      if (user && settings.smtp) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        sql.upsertEmailCode.run(user.id, emailCodeHash(user.id, code), now() + EMAIL_CODE_TTL_MS);
        const ctx = { to: user.email, locale: pickLocale(body.locale, req.headers['accept-language']), publicUrl: settings.publicUrl };
        mailerFactory(settings.smtp).send(emails.resetCode(ctx, code, EMAIL_CODE_TTL_MS / 60_000))
          .catch(err => console.error(`Code de réinitialisation non envoyé à ${user.email} :`, err instanceof Error ? err.message : err));
      }
      // Même réponse que le compte existe ou non
      return { status: 200, body: { emailCodeRequired: !!settings.smtp } };
    },

    'POST /api/v1/recovery/verify': async req => {
      limit(req, 'recovery');
      const body = await readJson(req, 4096);
      const email = parseEmail(body.email);
      const emailCode = parseCode(body.emailCode, 'emailCode');
      const totp = parseCode(body.totp, 'totp');
      const recoveryAuthHash = body.recoveryAuthHash === undefined || body.recoveryAuthHash === null
        ? null
        : parseBase64(body.recoveryAuthHash, 'recoveryAuthHash', { exact: 32 });

      const user = sql.userByEmail.get(email) as UserRow | undefined;
      const refuse = (message = 'Informations de récupération incorrectes') => new HttpError(401, 'recovery_invalid', message);
      // Travail constant : la clé de secours est toujours vérifiée, même pour un compte inconnu
      const keyValid = recoveryAuthHash ? await verifyRecoveryHash(user, recoveryAuthHash) : false;
      if (!user) throw refuse();

      let emailVerified = false;
      if (settings.smtp) {
        const row = sql.emailCodeByUser.get(user.id) as { code_hash: string; expires_at: number; attempts: number } | undefined;
        if (!row || row.expires_at <= now() || row.attempts >= MAX_EMAIL_CODE_ATTEMPTS) {
          throw refuse('Code email expiré. Demandez-en un nouveau.');
        }
        sql.bumpEmailCode.run(user.id);
        const expected = Buffer.from(row.code_hash, 'base64');
        const provided = Buffer.from(emailCodeHash(user.id, emailCode ?? ''), 'base64');
        if (!emailCode || !timingSafeEqual(expected, provided)) throw refuse('Code email incorrect');
        emailVerified = true;
      }

      let totpVerified = false;
      if (user.totp_enabled) {
        if (!totp) throw new HttpError(401, 'totp_required', 'Code de l’application d’authentification requis');
        if (!consumeTotp(user, totp)) throw new HttpError(401, 'totp_invalid', 'Code incorrect ou déjà utilisé');
        totpVerified = true;
      }

      if (recoveryAuthHash && !keyValid) throw refuse('Clé de secours incorrecte');
      // Sans clé de secours, le coffre est remplacé : il faut au moins un second facteur pour éviter qu'un tiers l'efface
      if (!recoveryAuthHash && !emailVerified && !totpVerified) {
        throw new HttpError(403, 'recovery_unavailable', 'Sans clé de secours, la réinitialisation demande un code email ou la double authentification');
      }

      const token = randomBytes(32).toString('base64url');
      sql.deleteRecoveryTokens.run(user.id);
      sql.insertRecoveryToken.run(sha256(token), user.id, keyValid ? 1 : 0, now() + RECOVERY_TOKEN_TTL_MS);
      return {
        status: 200,
        body: {
          token,
          withRecoveryKey: keyValid,
          wrappedVaultKey: keyValid ? JSON.parse(user.recovery_wrapped_key!) : null
        }
      };
    },

    'POST /api/v1/recovery/complete': async req => {
      limit(req, 'recovery');
      const body = await readJson(req, maxBody());
      if (typeof body.token !== 'string' || body.token.length !== 43) throw invalid('token');
      const row = sql.recoveryToken.get(sha256(body.token)) as { user_id: string; with_recovery_key: number; expires_at: number } | undefined;
      if (!row || row.expires_at <= now()) throw new HttpError(401, 'recovery_expired', 'La récupération a expiré, recommencez');

      const authHash = parseBase64(body.authHash, 'authHash', { exact: 32 });
      const kdf = parseKdf(body.kdf, minKdfMemory);
      const salt = parseBase64(body.salt, 'salt', { exact: 16 });
      const wrappedVaultKey = parseBlob(body.wrappedVaultKey, 'wrappedVaultKey', 64);
      const recovery = parseRecovery(body.recovery);
      const vault = row.with_recovery_key ? null : parseBlob(body.vault, 'vault', settings.limits.maxVaultBytes);
      const user = getUser(row.user_id);

      const authSalt = randomBytes(16);
      const verifier = await scryptVerifier(authHash, authSalt);
      const [recoveryVerifier, recoverySalt, recoveryWrapped] = await recoveryColumns(recovery);

      db.exec('BEGIN IMMEDIATE');
      try {
        sql.updateCredentials.run(verifier.toString('base64'), authSalt.toString('base64'), JSON.stringify(kdf), salt, JSON.stringify(wrappedVaultKey), user.id);
        if (vault) {
          sql.replaceVault.run(JSON.stringify(vault), now(), user.id);
          // L'ancienne clé de secours ouvrait l'ancien coffre : elle est remplacée ou retirée
          sql.updateRecovery.run(recoveryVerifier, recoverySalt, recoveryWrapped, user.id);
        } else if (recovery) {
          sql.updateRecovery.run(recoveryVerifier, recoverySalt, recoveryWrapped, user.id);
        }
        sql.deleteAllSessions.run(user.id);
        sql.deleteRecoveryTokens.run(user.id);
        sql.deleteEmailCode.run(user.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      notify(ctx => (vault ? emails.vaultReset(ctx, now()) : emails.passwordChanged(ctx, now(), true)), user);
      audit(vault ? 'account.reset_without_key' : 'account.recovered_with_key', {}, user.id);
      return { status: 200, body: { token: createSession(user.id, req), revision: readVault(user.id).revision } };
    },

    /* ── Administration ───────────────────────────────────────────────── */

    'GET /api/v1/admin/settings': async req => {
      requireAdmin(req);
      return {
        status: 200,
        body: {
          settings: publicSettings(settings),
          stats: {
            users: (sql.countUsers.get() as { count: number }).count,
            twoFactorUsers: (sql.twoFactorUsers.get() as { count: number }).count,
            storedBytes: (sql.vaultBytes.get() as { bytes: number }).bytes
          },
          version: SERVER_VERSION
        }
      };
    },

    'PUT /api/v1/admin/settings': async req => {
      requireAdmin(req);
      const body = await readJson(req, 16 * 1024);
      try {
        settings = parseSettingsUpdate(body, settings);
      } catch (err) {
        throw new HttpError(400, 'invalid_settings', err instanceof Error ? err.message : String(err));
      }
      writeSetting.run('settings', JSON.stringify(settings));
      audit('admin.settings_updated', { sections: Object.keys(body) });
      return { status: 200, body: { settings: publicSettings(settings) } };
    },

    'POST /api/v1/admin/smtp-test': async req => {
      requireAdmin(req);
      const body = await readJson(req, 4096);
      const to = parseEmail(body.to);
      if (!settings.smtp) throw new HttpError(400, 'smtp_disabled', 'Configurez d’abord le serveur SMTP');
      try {
        await mailerFactory(settings.smtp).send(emails.test(to, pickLocale(body.locale, req.headers['accept-language'])));
      } catch (err) {
        throw new HttpError(502, 'smtp_failed', `Envoi impossible : ${err instanceof Error ? err.message : err}`);
      }
      return { status: 204 };
    }
  };

  const backup: BackupService | null = options.backupFactory ? options.backupFactory(() => settings.backup) : null;

  const context: RouteContext = {
    db,
    now,
    limit,
    authenticate,
    getUser,
    verifyAuthHash,
    notify,
    settings: () => settings,
    filesDir: options.filesDir ?? null,
    maxBody,
    consumeTotp,
    clientAddress,
    limitsFor,
    audit,
    geo: options.geo ?? null
  };

  const legalContext = () => ({
    legal: settings.legal,
    retentionDays: settings.backup.retentionDays,
    backupsEnabled: settings.backup.enabled && !!settings.backup.s3,
    emailEnabled: !!settings.smtp,
    billingEnabled: settings.billing.enabled,
    geoEnabled: geoAvailable(),
    sessionDays: Math.round(sessionTtl / 86_400_000)
  });
  const legalDir = options.legalDir ?? fileURLToPath(new URL('../legal', import.meta.url));

  Object.assign(routes, accountKeyRoutes(context), sessionRoutes(context), billingRoutes(context, fetchImpl), avatarRoutes(context), {
    'GET /api/v1/legal': async (req: IncomingMessage): Promise<Reply> => {
      const locale = requestLocale(req);
      return {
        status: 200,
        body: {
          configured: legalConfigured(settings.legal),
          operatorName: settings.legal.operatorName || null,
          effectiveDate: settings.legal.effectiveDate || null,
          documents: LEGAL_DOCUMENTS.map(doc => ({ slug: doc.slug, title: legalTitle(doc, locale), url: `/legal/${doc.slug}?lang=${locale}` }))
        }
      };
    },
    'GET /api/v1/admin/dashboard': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req);
      return {
        status: 200,
        body: {
          version: SERVER_VERSION,
          generatedAt: now(),
          analytics: analytics(db, { now: now(), filesDir: options.filesDir ?? null, dbPath: options.dbPath ?? null }),
          system: options.metrics?.snapshot() ?? null,
          backups: { enabled: settings.backup.enabled, runs: backup?.history().slice(0, 5) ?? [] },
          security: {
            geoEnabled: geoAvailable(),
            emailEnabled: !!settings.smtp,
            registrationOpen: settings.registrationOpen,
            legalConfigured: legalConfigured(settings.legal),
            backupEncrypted: !!process.env.BACKUP_ENCRYPTION_KEY
          }
        }
      };
    },
    'GET /api/v1/admin/audit': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req);
      const rows = db.prepare('SELECT at, type, subject, detail FROM audit_events ORDER BY id DESC LIMIT 300').all() as Array<{ at: number; type: string; subject: string | null; detail: string }>;
      return { status: 200, body: { events: rows.map(r => ({ ...r, detail: JSON.parse(r.detail) })) } };
    },
    'POST /api/v1/admin/backup/download': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req);
      const passphrase = String((await readJson(req, 2048)).passphrase ?? '');
      if (passphrase.length < 12) throw new HttpError(400, 'weak_passphrase', 'Phrase de chiffrement de 12 caractères minimum');
      const payload = encryptBackup(databaseSnapshot(db), passphrase);
      audit('admin.backup_downloaded', { bytes: payload.length });
      return { status: 200, raw: payload, contentType: 'application/octet-stream' };
    },
    'GET /api/v1/admin/backup': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req);
      return {
        status: 200,
        body: { available: !!backup, running: backup?.isRunning() ?? false, runs: backup?.history() ?? [], encrypted: !!options.backupFactory && process.env.BACKUP_ENCRYPTION_KEY !== undefined && process.env.BACKUP_ENCRYPTION_KEY !== '' }
      };
    },
    'POST /api/v1/admin/backup/run': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req);
      if (!backup) throw new HttpError(503, 'backup_unavailable', 'Sauvegardes indisponibles sur ce serveur');
      try {
        const run = await backup.runNow('manual');
        audit('admin.backup_run', { status: run.status });
        return { status: 200, body: run };
      } catch (err) {
        throw new HttpError(502, 'backup_failed', err instanceof Error ? err.message : String(err));
      }
    },
    'POST /api/v1/admin/backup/test': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req);
      if (!backup) throw new HttpError(503, 'backup_unavailable', 'Sauvegardes indisponibles sur ce serveur');
      try {
        await backup.test();
      } catch (err) {
        throw new HttpError(502, 'backup_test_failed', err instanceof Error ? err.message : String(err));
      }
      return { status: 204 };
    }
  });
  const legalPage = (slug: string, req: IncomingMessage): Reply => {
    const lang = new URL(req.url ?? '/', 'http://localhost').searchParams.get('lang');
    const locale = lang === 'en' || lang === 'fr' ? lang : requestLocale(req);
    const html = renderLegalPage(legalDir, slug, legalContext(), locale);
    if (!html) throw new HttpError(404, 'not_found', 'Document inconnu');
    return { status: 200, raw: Buffer.from(html), contentType: 'text/html; charset=utf-8' };
  };

  const patternRoutes: PatternRoute[] = [
    ...sharingRoutes(context),
    ...attachmentRoutes(context),
    route('GET', '/legal', async req => legalPage('privacy', req)),
    route('GET', '/legal/:slug', async (req, params) => legalPage(params.slug, req))
  ];
  backup?.start();

  const applyHeaders = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (corsOrigins === '*') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', corsOrigins === '*' ? 'cross-origin' : 'same-site');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (settings.publicUrl.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  };

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    if (body === undefined) {
      res.writeHead(status).end();
      return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const startedAt = performance.now();
    let routeLabel = 'unknown';
    res.once('finish', () => options.metrics?.record(routeLabel, res.statusCode, performance.now() - startedAt));
    applyHeaders(req, res);
    if (req.method === 'OPTIONS') {
      send(res, 204);
      return;
    }
    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      let reply: Reply;
      const exact = routes[`${req.method} ${pathname}`];
      if (exact) {
        routeLabel = `${req.method} ${pathname}`;
        reply = await exact(req);
      } else {
        let matched: { run: PatternRoute['handler']; params: Record<string, string> } | null = null;
        for (const candidate of patternRoutes) {
          if (candidate.method !== req.method) continue;
          const match = candidate.pattern.exec(pathname);
          if (!match) continue;
          routeLabel = `${req.method} ${candidate.pattern.source.replace(/\(\[\^\/\]\+\)/g, ':param').replace(/^\^|\$$/g, '')}`;
          matched = { run: candidate.handler, params: Object.fromEntries(candidate.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])])) };
          break;
        }
        if (!matched) throw new HttpError(404, 'not_found', 'Route inconnue');
        reply = await matched.run(req, matched.params);
      }
      if (reply.raw) {
        res.writeHead(reply.status, { 'Content-Type': reply.contentType ?? 'application/octet-stream', 'Content-Length': reply.raw.length }).end(reply.raw);
      } else {
        send(res, reply.status, reply.body);
      }
    } catch (err) {
      const locale = requestLocale(req);
      if (err instanceof HttpError) {
        send(res, err.status, { error: { code: err.code, message: localizeMessage(err.message, locale), ...(err.details === undefined ? {} : { details: err.details }) } });
      } else {
        console.error(err);
        send(res, 500, { error: { code: 'internal', message: localizeMessage('Erreur interne du serveur', locale) } });
      }
    }
  };

  return Object.assign(handler, { close: () => backup?.stop() });
}
