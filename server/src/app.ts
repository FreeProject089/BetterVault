import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { addressKind, parsePlace, type Place } from './serverPlace.ts';
import { avatarInfo, avatarRoutes, DEFAULT_AVATARS } from './avatars.ts';
import { localizeMessage, requestLocale } from './messages.ts';
import {
  HttpError,
  RateLimitError,
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
import { databaseSnapshot, effectiveDestinations, encryptBackup, type BackupDestination, type BackupService, type BackupSettings } from './backup.ts';
import { sessionRoutes } from './sessions.ts';
import { billingRoutes, createLimitsResolver, createMissingStripePrices, stripeClient, STRIPE_WEBHOOK_EVENTS } from './billing.ts';
import { LEGAL_DOCUMENTS, legalConfigured, legalTitle, renderLegalPage } from './legal.ts';
import { renderNotMePage, renderNotMeDone, renderNotMeExpired } from './securityAlert.ts';
import { clusterRoutes, createClusterSync, installClusterSchema, type ClusterSync } from './cluster.ts';
import { createClusterTrust } from './clusterTrust.ts';
import { createAdminAuth, type AdminPermission } from './adminAuth.ts';
import { analytics, createAudit, type Metrics } from './metrics.ts';
import { describeUserAgent, truncateIp, type GeoLookup } from './geoip.ts';
import { route } from './context.ts';
import type { DatabaseSync } from 'node:sqlite';
import { parseS3, parseSettingsUpdate, publicSettings, settingsFromEnv, type ServerSettings } from './config.ts';
import { createSmtpMailer, type Mailer, type MailMessage, type SmtpConfig } from './mailer.ts';
import { emails, pickLocale, type EmailContext, type Locale } from './emails.ts';
import { createEmailTemplates, isEmailKind, isEmailLocale } from './emailTemplates.ts';
import { createLanguages, LanguageError } from './languages.ts';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.ts';
import { createWebauthn, parseRpId, type AssertionInput } from './webauthn.ts';
import { DEFAULT_PUBLIC_PAGE, publicDirectory, renderDownloadsPage, renderLanding, renderPlansPage, renderServersPage, type PublicPlan } from './directory.ts';
import { legacyDocPath, renderDocPage } from './docs.ts';
import { SITE_JS } from './siteScript.ts';
import { createSiteLinks } from './siteLinks.ts';
import { createReleases } from './releases.ts';
import { BASE_LANGS, type ChromeContext, type PageLang } from './siteChrome.ts';

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
  /** Paramètres annoncés pour un compte inconnu ; les tests les abaissent pour ne pas dériver une clé Argon2id complète à chaque échec */
  decoyKdf?: KdfParams;
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
  /** Dossier des fichiers Markdown servis sous /docs */
  docsDir?: string;
  /** L'application web est servie par ce même serveur (lien « Ouvrir l'application » de /about) */
  appAvailable?: boolean;
  /** Appels HTTP sortants (Stripe) ; remplaçable dans les tests */
  fetchImpl?: typeof fetch;
  /** Lance la réplication périodique (désactivé dans les tests, qui la déclenchent à la main) */
  clusterAutoStart?: boolean;
  /** Fréquence de la réplication entre nœuds */
  clusterIntervalMs?: number;
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

export function createApp(options: AppOptions): ((req: IncomingMessage, res: ServerResponse) => Promise<void>) & { close(): void; cluster: ClusterSync } {
  const { db, serverSecret } = options;
  if (serverSecret.length < 32) throw new Error('Le secret serveur doit contenir au moins 32 caractères');

  const now = options.now ?? Date.now;
  const sessionTtl = options.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  const minKdfMemory = options.minKdfMemoryKib ?? 19456;
  const decoyKdf = options.decoyKdf ?? DEFAULT_KDF;
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

  /*
   * Grappe : l'identité du nœud existe toujours ; la réplication ne s'active qu'une
   * fois le nœud membre d'une grappe (créée ou rejointe depuis l'administration).
   */
  const trust = createClusterTrust({
    db,
    serverSecret,
    now,
    fetchImpl: options.fetchImpl,
    audit: (type, detail) => audit(type, detail),
    onMember: (nodeId, zone) => installClusterSchema(db, nodeId, zone)
  });
  if (trust.isMember()) installClusterSchema(db, trust.selfId, trust.zone());
  const clusterReady = () => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'vault_conflicts'").get();
  const cluster: ClusterSync = createClusterSync({
    db,
    auth: trust,
    filesDir: options.filesDir ?? null,
    fetchImpl: options.fetchImpl,
    now,
    intervalMs: options.clusterIntervalMs
  });

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
    insertSecurityAlert: db.prepare('INSERT INTO security_alerts (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    securityAlertByHash: db.prepare('SELECT * FROM security_alerts WHERE token_hash = ?'),
    useSecurityAlert: db.prepare('UPDATE security_alerts SET used_at = ? WHERE token_hash = ? AND used_at IS NULL'),
    purgeSecurityAlerts: db.prepare('DELETE FROM security_alerts WHERE expires_at <= ?'),
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

  /*
   * Adresse telle que la comptent les limites de tentatives.
   *
   * Une connexion IPv6 reçoit tout un bloc (un /64, souvent un /56 ou un /48) :
   * compter chaque adresse à part laissait changer d'adresse à chaque essai et
   * repartir de zéro, sur toutes les limites. On compte donc par /56. Une IPv4
   * écrite en IPv6 (« ::ffff:1.2.3.4 ») est ramenée à l'IPv4.
   */
  const rateAddress = (req: IncomingMessage) => {
    const address = clientAddress(req).replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
    if (!address.includes(':')) return address;
    const [head, tail = ''] = address.toLowerCase().split('%')[0].split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = address.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
    const hex = groups.slice(0, 4).map(g => g.padStart(4, '0')).join('');
    return `${hex.slice(0, 14)}::/56`;
  };

  /*
   * Limites de tentatives, par action et par adresse.
   *
   * Une seule règle pour tout (20 par minute) était à la fois trop large pour
   * deviner un mot de passe et trop étroite pour l'usage normal : chaque page
   * de l'administration passait par elle, et on se faisait bloquer en
   * naviguant. Chaque action a maintenant sa fenêtre et son plafond, et la
   * réponse dit combien de temps attendre.
   */
  const BUCKETS: Record<string, { windowMs: number; max: number }> = {
    // Lu à chaque connexion, ne révèle rien : large
    prelogin: { windowMs: 60_000, max: 60 },
    login: { windowMs: 60_000, max: 10 },
    register: { windowMs: 60 * 60_000, max: 10 },
    password: { windowMs: 60_000, max: 10 },
    recovery: { windowMs: 15 * 60_000, max: 10 },
    delete: { windowMs: 60 * 60_000, max: 5 },
    // Administration : l'usage normal est large, seuls les échecs sont comptés serré
    admin: { windowMs: 60_000, max: 600 },
    'admin-fail': { windowMs: 15 * 60_000, max: 10 },
    'admin-login': { windowMs: 15 * 60_000, max: 10 }
  };
  const bucketRule = (bucket: string) => options.authRateLimit ?? BUCKETS[bucket] ?? { windowMs: 60_000, max: 20 };

  const waitMessage = (seconds: number) => seconds <= 90
    ? `Trop de tentatives, réessayez dans ${seconds} s`
    : `Trop de tentatives, réessayez dans ${Math.ceil(seconds / 60)} min`;

  /*
   * Échecs comptés par compte, quelle que soit l'adresse : une limite par
   * adresse ne voit rien d'un essai réparti sur beaucoup d'adresses. La clé est
   * ce que la personne a tapé (email en minuscules, ou identifiant du compte),
   * si bien que la réponse est la même que le compte existe ou non.
   * Contrepartie assumée : un tiers peut bloquer un compte quelques minutes en
   * accumulant les échecs. Le propriétaire garde la clé de secours.
   */
  const ACCOUNT_RULES: Record<string, { windowMs: number; max: number }> = {
    // Récupération sans clé de secours : un code TOTP deviné remplace le coffre
    'totp-recovery': { windowMs: 15 * 60_000, max: 5 },
    // Mauvais mot de passe ou mauvais code, à la connexion d'un compte
    'login-fail': { windowMs: 15 * 60_000, max: 20 },
    // Mauvais identifiants sur un compte d'administration
    'admin-login-fail': { windowMs: 15 * 60_000, max: 10 }
  };
  const accountAttempts = new Map<string, { count: number; resetAt: number }>();
  const accountBlocked = (bucket: string, key: string) => {
    const entry = accountAttempts.get(`${bucket}:${key}`);
    const current = now();
    if (entry && entry.resetAt > current && entry.count >= ACCOUNT_RULES[bucket].max) {
      const seconds = Math.max(1, Math.ceil((entry.resetAt - current) / 1000));
      throw new RateLimitError(seconds, waitMessage(seconds));
    }
  };
  const accountFailure = (bucket: string, key: string) => {
    const id = `${bucket}:${key}`;
    const current = now();
    const entry = accountAttempts.get(id);
    if (!entry || entry.resetAt <= current) {
      if (accountAttempts.size > 50_000) {
        for (const [existing, value] of accountAttempts) if (value.resetAt <= current) accountAttempts.delete(existing);
        let excess = accountAttempts.size - 40_000;
        for (const existing of accountAttempts.keys()) {
          if (excess-- <= 0) break;
          accountAttempts.delete(existing);
        }
      }
      accountAttempts.set(id, { count: 1, resetAt: current + ACCOUNT_RULES[bucket].windowMs });
      return;
    }
    entry.count++;
  };

  /** Refuse si le plafond est déjà atteint, sans compter cette requête */
  const blocked = (req: IncomingMessage, bucket: string) => {
    const entry = attempts.get(`${bucket}:${rateAddress(req)}`);
    const current = now();
    if (entry && entry.resetAt > current && entry.count >= bucketRule(bucket).max) {
      const seconds = Math.max(1, Math.ceil((entry.resetAt - current) / 1000));
      throw new RateLimitError(seconds, waitMessage(seconds));
    }
  };

  const limit = (req: IncomingMessage, bucket: string) => {
    const rule = bucketRule(bucket);
    const key = `${bucket}:${rateAddress(req)}`;
    const current = now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= current) {
      // Purge des entrées expirées plutôt qu'un vidage total : vider remettrait à
      // zéro les compteurs de tout le monde, ce qui se provoque facilement.
      if (attempts.size > 10_000) {
        for (const [existing, value] of attempts) {
          if (value.resetAt <= current) attempts.delete(existing);
        }
        // Encore plein : on retire les plus anciennes (ordre d'insertion), jamais tout.
        // Vider la table remettait à zéro les blocages de tout le monde, il suffisait
        // de la remplir d'adresses différentes pour lever un blocage.
        if (attempts.size > 20_000) {
          let excess = attempts.size - 15_000;
          for (const existing of attempts.keys()) {
            if (excess-- <= 0) break;
            attempts.delete(existing);
          }
        }
      }
      attempts.set(key, { count: 1, resetAt: current + rule.windowMs });
      return;
    }
    entry.count++;
    if (entry.count > rule.max) {
      const seconds = Math.max(1, Math.ceil((entry.resetAt - current) / 1000));
      throw new RateLimitError(seconds, waitMessage(seconds));
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

  const webauthn = createWebauthn(db, now);

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

  /*
   * Versions du coffre écartées par la grappe quand deux nœuds ont été modifiés en
   * parallèle. Le serveur ne sait pas les fusionner — il ne lit pas le coffre — donc
   * il les rend à l'application, qui les fusionne et les acquitte à l'écriture suivante.
   */
  const vaultConflicts = (userId: string): Array<{ hash: string; blob: EncryptedBlob }> => {
    if (!clusterReady()) return [];
    return (db.prepare('SELECT hash, blob FROM vault_conflicts WHERE user_id = ? ORDER BY received_at').all(userId) as Array<{ hash: string; blob: string }>)
      .map(row => ({ hash: row.hash, blob: JSON.parse(row.blob) as EncryptedBlob }));
  };

  const readVault = (userId: string) => {
    const row = sql.vaultByUser.get(userId) as { revision: number; blob: string; updated_at: number } | undefined;
    const conflicts = vaultConflicts(userId);
    return row
      ? { revision: row.revision, blob: JSON.parse(row.blob) as EncryptedBlob, updatedAt: row.updated_at, ...(conflicts.length ? { conflicts } : {}) }
      : { revision: 0, blob: null, updatedAt: null };
  };

  const emailTemplates = createEmailTemplates(db);
  const languages = createLanguages(db, now);

  /*
   * Langue d'un email : celle du compte, sinon celle choisie par
   * l'administration (anglais tant que personne n'a rien choisi).
   */
  const locale = (user: UserRow): Locale => (user.locale === 'fr' || user.locale === 'en' ? user.locale : emailTemplates.defaultLocale());

  const ALERT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Lien « ce n'était pas moi » joint à un email de sécurité.
   *
   * Il faut du temps pour lire un email : sept jours, contre dix minutes pour un
   * jeton de récupération. Le lien ne sert qu'une fois, et il n'ouvre qu'une
   * action — fermer les sessions — donc l'exposition reste faible.
   *
   * Sans adresse publique configurée, il n'y a nulle part où pointer : l'email
   * part alors sans bouton, avec le conseil écrit seulement.
   */
  const alertLink = (user: UserRow, kind: string): string | undefined => {
    if (!settings.publicUrl) return undefined;
    const token = randomBytes(32).toString('base64url');
    sql.purgeSecurityAlerts.run(now());
    sql.insertSecurityAlert.run(sha256(token), user.id, kind, now(), now() + ALERT_TOKEN_TTL_MS);
    return `${settings.publicUrl.replace(/\/+$/, '')}/security/not-me/${token}`;
  };

  /** Envoi en arrière-plan : une panne du serveur SMTP ne bloque jamais l'utilisateur */
  /**
   * Envoie un email à un compte. `kind` nomme le message : c'est ce qui permet
   * d'appliquer la personnalisation posée par l'administration.
   */
  const notify = (
    kind: string,
    build: (ctx: EmailContext) => MailMessage,
    user: UserRow,
    alertKind?: string
  ) => {
    if (!settings.smtp) return;
    const langue = locale(user);
    const message = build({
      to: user.email,
      locale: langue,
      publicUrl: settings.publicUrl,
      notMeUrl: alertKind ? alertLink(user, alertKind) : undefined,
      override: emailTemplates.override(kind, langue)
    });
    mailerFactory(settings.smtp).send(message).catch(err => console.error(`Email non envoyé à ${user.email} :`, err instanceof Error ? err.message : err));
  };

  /*
   * Administration : comptes avec rôles (adminAuth.ts). Le jeton ADMIN_TOKEN reste
   * un accès de secours de propriétaire. `sensitive` exige une reconfirmation récente.
   */
  const adminAuth = createAdminAuth({
    db,
    breakGlassHash: options.adminTokenHash ?? null,
    now,
    limit: (req, bucket) => limit(req, bucket),
    blocked: (req, bucket) => blocked(req, bucket),
    accountBlocked: key => accountBlocked('admin-login-fail', key),
    accountFailure: key => accountFailure('admin-login-fail', key),
    audit: (type, detail) => audit(type, detail)
  });
  const requireAdmin = (req: IncomingMessage, permission: AdminPermission = 'view', sensitive = false) => adminAuth.require(req, permission, sensitive);

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
        avatars: { ...(settings.avatars ?? DEFAULT_AVATARS), maxBytes: settings.limits.maxAvatarBytes },
        // Consulté avant un import : l'application sait d'avance si les fichiers auront leur place
        attachments: {
          enabled: !!options.filesDir && settings.attachmentsEnabled !== false,
          maxBytes: settings.limits.maxAttachmentBytes,
          quotaBytes: settings.limits.attachmentQuotaBytes
        }
      }
    }),

    'POST /api/v1/sessions/prelogin': async req => {
      limit(req, 'prelogin');
      const email = parseEmail((await readJson(req, 4096)).email);
      const user = sql.userByEmail.get(email) as UserRow | undefined;
      if (user) return { status: 200, body: { kdf: JSON.parse(user.kdf), salt: user.salt } };
      // Compte inconnu : réponse stable et crédible pour ne pas révéler l'existence des comptes
      const salt = createHmac('sha256', serverSecret).update(`prelogin:${email}`).digest().subarray(0, 16).toString('base64');
      return { status: 200, body: { kdf: decoyKdf, salt } };
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
      // Sans cette vérification, la même adresse pourrait désigner deux comptes sur deux nœuds
      if (trust.isMember() && await cluster.emailTaken(email)) throw new HttpError(409, 'email_taken', 'Un compte existe déjà pour cet email');

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
        if (trust.isMember()) db.prepare('UPDATE users SET home_zone = ? WHERE id = ?').run(trust.zone(), userId);
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
      accountBlocked('login-fail', email.toLowerCase());

      if (!(await verifyAuthHash(user, authHash)) || !user) {
        accountFailure('login-fail', email.toLowerCase());
        throw new HttpError(401, 'invalid_credentials', 'Email ou mot de passe incorrect');
      }
      /*
       * Second facteur : un code de l'application, ou une clé de sécurité enregistrée
       * pour le domaine de l'application qui se connecte. Sans l'un ni l'autre, on
       * renvoie ce qui est possible, avec un défi prêt si une clé existe ici.
       */
      const hasKeys = webauthn.keysFor(user.id).length > 0;
      if (user.totp_enabled || hasKeys) {
        if (body.webauthn) {
          webauthn.verifyLogin(user.id, body.rpId, body.webauthn as AssertionInput);
        } else if (totp && user.totp_enabled) {
          if (!consumeTotp(user, totp)) {
            accountFailure('login-fail', email.toLowerCase());
            throw new HttpError(401, 'totp_invalid', 'Code incorrect ou déjà utilisé');
          }
        } else {
          const options = hasKeys && body.rpId !== undefined ? webauthn.loginOptions(user.id, parseRpId(body.rpId)) : null;
          const details = { totp: !!user.totp_enabled, webauthn: options, otherKeys: hasKeys && !options };
          if (!options && !user.totp_enabled) {
            throw new HttpError(401, 'security_key_elsewhere', 'Votre clé de sécurité est enregistrée dans une autre application BetterVault. Connectez-vous depuis celle-ci, ou utilisez votre clé de récupération.', details);
          }
          throw new HttpError(401, options ? 'second_factor_required' : 'totp_required',
            options ? 'Clé de sécurité ou code de l’application requis' : 'Code de l’application d’authentification requis', details);
        }
      }

      if (body.locale === 'fr' || body.locale === 'en') sql.updateLocale.run(body.locale, user.id);
      sql.deleteExpiredSessions.run(now());
      if (body.notify !== false) {
        const client = describeClient(req);
        const place = [client.city, client.country].filter(Boolean).join(', ');
        notify('newLogin', ctx => emails.newLogin(ctx, now(), `${client.ipPrefix}${place ? ` (${place})` : ''}`, client.device), user, 'new_login');
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
      // Versions concurrentes que l'application vient de fusionner dans ce qu'elle écrit
      if (clusterReady() && Array.isArray(body.mergedConflicts)) {
        const clear = db.prepare('DELETE FROM vault_conflicts WHERE user_id = ? AND hash = ?');
        for (const hash of (body.mergedConflicts as unknown[]).slice(0, 100)) {
          if (typeof hash === 'string' && hash.length <= 64) clear.run(userId, hash);
        }
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
          securityKeys: webauthn.list(user.id),
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
      notify('passwordChanged', ctx => emails.passwordChanged(ctx, now(), false), user, 'password_changed');
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
      notify('recoveryKeyChanged', ctx => emails.recoveryKeyChanged(ctx, now()), user, 'recovery_key_changed');
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
      notify('twoFactor', ctx => emails.twoFactor(ctx, now(), true), user, 'totp_enabled');
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
      if (user.totp_enabled) notify('twoFactor', ctx => emails.twoFactor(ctx, now(), false), user, 'totp_disabled');
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
      db.prepare('DELETE FROM security_keys WHERE user_id = ?').run(userId);
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
        // Qui n'a rien demandé doit pouvoir annuler la réinitialisation, pas seulement ignorer l'email
        // La langue du formulaire l'emporte : la personne est en train de le remplir
        const langue = pickLocale(body.locale, req.headers['accept-language']);
        const ctx = {
          to: user.email,
          locale: langue,
          publicUrl: settings.publicUrl,
          notMeUrl: alertLink(user, 'reset_requested'),
          override: emailTemplates.override('resetCode', langue)
        };
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
      /*
       * Email inconnu : même réponse qu'un compte réel dont le code email n'a
       * pas été demandé (ou est expiré). Sinon le message trahissait qui a un
       * compte ici, alors que /recovery/start répond pareil dans les deux cas.
       */
      if (!user) throw refuse(settings.smtp ? 'Code email expiré. Demandez-en un nouveau.' : undefined);

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
        accountBlocked('totp-recovery', user.id);
        if (!consumeTotp(user, totp)) {
          accountFailure('totp-recovery', user.id);
          throw new HttpError(401, 'totp_invalid', 'Code incorrect ou déjà utilisé');
        }
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

      notify(vault ? 'vaultReset' : 'passwordChanged', ctx => (vault ? emails.vaultReset(ctx, now()) : emails.passwordChanged(ctx, now(), true)), user, 'recovery');
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
      requireAdmin(req, 'manage', true);
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

    /*
     * Offres créées de zéro dans /admin : produit et prix créés dans Stripe
     * avec la seule clé secrète. Les identifiants obtenus sont enregistrés.
     */
    'POST /api/v1/admin/billing/stripe-sync': async req => {
      requireAdmin(req, 'manage', true);
      const result = await createMissingStripePrices(settings.billing.plans, stripeClient(context, fetchImpl));
      settings = { ...settings, billing: { ...settings.billing, plans: result.plans } };
      writeSetting.run('settings', JSON.stringify(settings));
      audit('admin.billing_stripe_sync', { created: result.created });
      // Ce qui a été créé est enregistré ; l'erreur est remontée ensuite
      if (result.error) throw result.error;
      return { status: 200, body: { created: result.created, settings: publicSettings(settings) } };
    },

    /** Ce que le webhook Stripe doit connaître : son adresse et les événements à envoyer */
    'GET /api/v1/admin/billing/webhook-info': async req => {
      requireAdmin(req, 'view');
      const base = settings.publicUrl;
      return { status: 200, body: { url: base ? `${base}/api/v1/billing/webhook` : null, events: STRIPE_WEBHOOK_EVENTS } };
    },

    'POST /api/v1/admin/smtp-test': async req => {
      requireAdmin(req, 'operate');
      const body = await readJson(req, 4096);
      const to = parseEmail(body.to);
      if (!settings.smtp) throw new HttpError(400, 'smtp_disabled', 'Configurez d’abord le serveur SMTP');
      const locale = isEmailLocale(body.locale) ? body.locale : emailTemplates.defaultLocale();
      try {
        await mailerFactory(settings.smtp).send(emails.test(to, locale, emailTemplates.override('test', locale)));
      } catch (err) {
        throw new HttpError(502, 'smtp_failed', `Envoi impossible : ${err instanceof Error ? err.message : err}`);
      }
      return { status: 204 };
    },

    /* ── Emails : aperçu et personnalisation ──────────────────────────── */

    'GET /api/v1/admin/emails': async req => {
      requireAdmin(req);
      return { status: 200, body: emailTemplates.view() };
    },

    'PUT /api/v1/admin/emails/locale': async req => {
      requireAdmin(req, 'manage');
      const body = await readJson(req, 512);
      if (!isEmailLocale(body.locale)) throw new HttpError(400, 'bad_locale', 'Langue inconnue');
      emailTemplates.setDefaultLocale(body.locale);
      audit('admin.email_locale_changed', { locale: body.locale });
      return { status: 200, body: { defaultLocale: body.locale } };
    },

    'PUT /api/v1/admin/emails/template': async req => {
      requireAdmin(req, 'manage');
      const body = await readJson(req, 4096);
      if (!isEmailKind(body.id)) throw new HttpError(400, 'bad_email_kind', 'Message inconnu');
      if (!isEmailLocale(body.locale)) throw new HttpError(400, 'bad_locale', 'Langue inconnue');
      const saved = emailTemplates.save(body.id, body.locale, { subject: body.subject, intro: body.intro });
      audit('admin.email_template_saved', { id: body.id, locale: body.locale, cleared: !saved });
      return { status: 200, body: { template: saved ?? { subject: '', intro: '' } } };
    },

    /*
     * Aperçu : renvoie le vrai HTML de l'email, avec des valeurs d'exemple. Le
     * brouillon passé dans la requête permet de voir sa personnalisation avant
     * de l'enregistrer. La page d'administration l'affiche dans un cadre
     * cloisonné : ce HTML n'est pas fait pour s'exécuter chez elle.
     */
    'POST /api/v1/admin/emails/preview': async req => {
      requireAdmin(req);
      const body = await readJson(req, 4096);
      if (!isEmailKind(body.id)) throw new HttpError(400, 'bad_email_kind', 'Message inconnu');
      const locale = isEmailLocale(body.locale) ? body.locale : emailTemplates.defaultLocale();
      const draft = body.draft && typeof body.draft === 'object'
        ? { subject: (body.draft as Record<string, unknown>).subject, intro: (body.draft as Record<string, unknown>).intro }
        : undefined;
      const message = emailTemplates.preview(body.id, locale, settings.publicUrl, draft as never);
      if (!message) throw new HttpError(400, 'bad_email_kind', 'Message inconnu');
      return { status: 200, body: { subject: message.subject, text: message.text, html: message.html } };
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
    backupsEnabled: settings.backup.enabled && effectiveDestinations(settings.backup).some(d => d.status === 'active'),
    emailEnabled: !!settings.smtp,
    billingEnabled: settings.billing.enabled,
    geoEnabled: geoAvailable(),
    sessionDays: Math.round(sessionTtl / 86_400_000)
  });
  const legalDir = options.legalDir ?? fileURLToPath(new URL('../legal', import.meta.url));
  const docsDir = options.docsDir ?? fileURLToPath(new URL('../../docs', import.meta.url));

  Object.assign(routes, adminAuth.routes, accountKeyRoutes(context), sessionRoutes(context), billingRoutes(context, fetchImpl), avatarRoutes(context), {
    // Consultable sans session : l'application interroge ce serveur avant même
    // de proposer la création d'un compte, pour savoir s'il y a des conditions à accepter.
    'GET /api/v1/legal': async (req: IncomingMessage): Promise<Reply> => {
      const locale = requestLocale(req);
      if (!settings.legal.enabled) {
        return { status: 200, body: { enabled: false, configured: true, operatorName: null, effectiveDate: null, documents: [] } };
      }
      return {
        status: 200,
        body: {
          enabled: true,
          configured: legalConfigured(settings.legal),
          operatorName: settings.legal.operatorName || null,
          effectiveDate: settings.legal.effectiveDate || null,
          documents: LEGAL_DOCUMENTS.map(doc => ({ slug: doc.slug, title: legalTitle(doc, locale), url: `/legal/${doc.slug}?lang=${locale}` }))
        }
      };
    },
    // Annuaire de serveurs recommandés par cet hébergeur, lu par l'application avant la connexion
    /*
     * Serveurs à proposer au moment de choisir un serveur : l'annuaire de
     * l'hébergeur, et les nœuds actifs de la grappe. Un compte existe dans sa
     * zone : les nœuds d'une même zone le partagent, pas les autres.
     */
    'GET /api/v1/directory': async () => ({
      status: 200,
      body: {
        ...publicDirectory(settings.publicPage ?? DEFAULT_PUBLIC_PAGE),
        cluster: (trust.snapshot().cluster?.nodes ?? [])
          .filter(node => node.status === 'active')
          .map(node => ({ name: node.name, url: node.url, region: node.region, zone: node.zone }))
      }
    }),

    /** Langues proposées en plus du français et de l'anglais */
    'GET /api/v1/i18n': async () => ({
      status: 200,
      body: { languages: languages.list().map(({ code, name, updatedAt }) => ({ code, name, updatedAt })) }
    }),

    'GET /api/v1/admin/i18n': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req);
      return { status: 200, body: { languages: languages.list() } };
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
          backups: (() => {
            const view = backupView();
            return { enabled: view.enabled, encrypted: view.encrypted, destinations: view.destinations.map(d => ({ name: d.name, health: d.health })), runs: view.runs.slice(0, 5) };
          })(),
          security: {
            geoEnabled: geoAvailable(),
            emailEnabled: !!settings.smtp,
            registrationOpen: settings.registrationOpen,
            legalEnabled: settings.legal.enabled,
            legalConfigured: legalConfigured(settings.legal),
            backupEncrypted: !!process.env.BACKUP_ENCRYPTION_KEY
          },
          // État de la réplication : un nœud en retard ou en erreur doit se voir tout de suite
          cluster: clusterView()
        }
      };
    },
    'POST /api/v1/admin/cluster/sync': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req, 'operate');
      if (!trust.isMember()) throw new HttpError(404, 'cluster_disabled', 'Ce serveur ne fait pas partie d’une grappe');
      await cluster.syncNow();
      return { status: 200, body: clusterView() };
    },
    'GET /api/v1/admin/audit': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req);
      const rows = db.prepare('SELECT at, type, subject, detail FROM audit_events ORDER BY id DESC LIMIT 300').all() as Array<{ at: number; type: string; subject: string | null; detail: string }>;
      return { status: 200, body: { events: rows.map(r => ({ ...r, detail: JSON.parse(r.detail) })) } };
    },
    'POST /api/v1/admin/backup/download': async (req: IncomingMessage): Promise<Reply> => {
      requireAdmin(req, 'manage', true);
      const passphrase = String((await readJson(req, 2048)).passphrase ?? '');
      if (passphrase.length < 12) throw new HttpError(400, 'weak_passphrase', 'Phrase de chiffrement de 12 caractères minimum');
      const payload = encryptBackup(databaseSnapshot(db), passphrase);
      audit('admin.backup_downloaded', { bytes: payload.length });
      return { status: 200, raw: payload, contentType: 'application/octet-stream' };
    },
  });
  /** Liens communautaires, relus au plus une fois par heure depuis l'adresse réglée dans /admin */
  const siteLinks = createSiteLinks({ url: () => (settings.publicPage ?? DEFAULT_PUBLIC_PAGE).linksUrl ?? '' });
  /** Dernière version publiée sur le dépôt GitHub des liens, pour la page Télécharger */
  let githubRepo = '';
  const latestRelease = createReleases({ repoUrl: () => githubRepo });

  /*
   * Langue des pages publiques : ?lang= l'impose et la retient un an (cookie
   * sans valeur sensible), sinon le cookie, sinon la langue du navigateur.
   */
  type PageLocale = { locale: 'fr' | 'en'; lang?: string; strings?: Record<string, string>; langs: PageLang[]; cookie?: string };
  const pageLocale = (req: IncomingMessage): PageLocale => {
    // Langues proposées : français, anglais, puis les packs de l'administration
    const packs = languages.list().filter(pack => pack.code !== 'fr' && pack.code !== 'en');
    const langs: PageLang[] = [...BASE_LANGS, ...packs.map(pack => ({ code: pack.code, label: pack.name || pack.code }))];
    const known = (code: string | null | undefined) => (code && langs.some(l => l.code === code) ? code : null);
    const asked = known(new URL(req.url ?? '/', 'http://localhost').searchParams.get('lang'));
    const saved = known(/(?:^|;\s*)bv_lang=([a-zA-Z-]{2,12})(?:;|$)/.exec(String(req.headers.cookie ?? ''))?.[1]);
    const code = asked ?? saved ?? (requestLocale(req) === 'en' ? 'en' : 'fr');
    // Le code vient de la liste ci-dessus (LANGUAGE_CODE) : rien d'autre n'entre dans l'en-tête
    const cookie = asked ? `bv_lang=${asked}; Path=/; Max-Age=31536000; SameSite=Lax` : undefined;
    if (code === 'fr' || code === 'en') return { locale: code, langs, cookie };
    return { locale: 'en', lang: code, strings: languages.get(code)?.strings ?? {}, langs, cookie };
  };
  const withCookie = (reply: Reply, cookie?: string): Reply => (cookie ? { ...reply, headers: { ...(reply.headers ?? {}), 'Set-Cookie': cookie } } : reply);
  /** Thème choisi avec le bouton de la barre (cookie bv_theme) ; sans lui, la page suit le système */
  const pageTheme = (req: IncomingMessage): 'light' | 'dark' | undefined =>
    /(?:^|;\s*)bv_theme=(light|dark)(?:;|$)/.exec(String(req.headers.cookie ?? ''))?.[1] as 'light' | 'dark' | undefined;

  /** Offres affichées sur la page des tarifs : sans identifiants Stripe */
  const publicPlans = (): PublicPlan[] => settings.billing.enabled
    ? settings.billing.plans
        .map(plan => ({ ...plan, prices: plan.prices.filter(price => price.stripePriceId) }))
        .filter(plan => plan.prices.length)
        .map(plan => ({
          id: plan.id, name: plan.name, description: plan.description, boosts: plan.boosts,
          prices: plan.prices.map(price => ({ label: price.label, amount: price.amount, currency: price.currency, interval: price.interval }))
        }))
    : [];

  /** Serveurs actifs de la grappe, montrés sur l'accueil quand il y en a plusieurs */
  const officialServers = () => {
    const view = clusterView(false);
    return (view.cluster?.nodes ?? [])
      .filter(node => node.status === 'active')
      .map(node => ({ name: node.name, region: node.region ?? '', zone: node.zone ?? '', online: node.health === 'self' || node.health === 'ok' }));
  };

  /** Contexte commun des pages publiques (accueil, tarifs, serveurs) */
  const landingContext = async (req: IncomingMessage) => {
    const { locale, lang, strings, langs, cookie } = pageLocale(req);
    const url = new URL(req.url ?? '/', 'http://localhost');
    return {
      cookie,
      ctx: {
        lang, strings, langs,
        theme: pageTheme(req),
        page: settings.publicPage ?? DEFAULT_PUBLIC_PAGE,
        operatorName: settings.legal.operatorName ?? '',
        registrationOpen: settings.registrationOpen,
        legalEnabled: settings.legal.enabled,
        appAvailable: !!options.appAvailable,
        version: SERVER_VERSION,
        locale,
        links: await siteLinks(),
        path: url.pathname,
        officialServers: officialServers(),
        plans: publicPlans(),
        freeLimits: { maxVaults: settings.limits.maxVaults, maxCredentialsPerVault: settings.limits.maxCredentialsPerVault, attachmentQuotaBytes: settings.limits.attachmentQuotaBytes }
      }
    };
  };

  /** En-tête et pied communs des pages publiques */
  const siteChrome = async (req: IncomingMessage): Promise<ChromeContext> => {
    const page = settings.publicPage ?? DEFAULT_PUBLIC_PAGE;
    const url = new URL(req.url ?? '/', 'http://localhost');
    return {
      ...(({ locale, lang, strings, langs }) => ({ locale, lang, strings, langs }))(pageLocale(req)),
      appAvailable: !!options.appAvailable,
      serversOn: page.directoryEnabled && page.servers.length > 0,
      legalEnabled: settings.legal.enabled,
      version: SERVER_VERSION,
      operatorName: settings.legal.operatorName ?? '',
      plansOn: publicPlans().length > 0,
      links: await siteLinks(),
      path: url.pathname,
      theme: pageTheme(req)
    };
  };
  const legalPage = async (slug: string, req: IncomingMessage): Promise<Reply> => {
    const { locale, cookie } = pageLocale(req);
    const html = renderLegalPage(legalDir, slug, legalContext(), locale, { ...(await siteChrome(req)), locale });
    if (!html) throw new HttpError(404, 'not_found', 'Document inconnu');
    // Même politique que les autres pages : le texte vient en partie des réglages de l'hébergeur
    return withCookie(htmlReply(html), cookie);
  };

  /*
   * « Ce n'était pas moi ».
   *
   * Le jeton du lien est la seule preuve, et c'est assez : il n'a été envoyé qu'à
   * l'adresse du compte, il ne sert qu'une fois, et la seule action qu'il ouvre est
   * de fermer des sessions. Un tiers qui l'obtiendrait ne pourrait que déconnecter
   * des appareils — désagréable, jamais dangereux.
   *
   * La lecture (GET) ne fait rien : elle montre une page et demande confirmation.
   * Les clients de messagerie et les anti-spam suivent les liens des emails pour
   * les inspecter ; agir dès le GET reviendrait à déconnecter tout le monde à chaque
   * analyse automatique.
   */
  const alertByToken = (token: string) => {
    const row = sql.securityAlertByHash.get(sha256(token)) as
      { token_hash: string; user_id: string; kind: string; expires_at: number; used_at: number | null } | undefined;
    if (!row || row.used_at !== null || row.expires_at <= now()) return null;
    return row;
  };

  /*
   * Pages rendues par l'API (documentation, page publique, documents légaux) :
   * aucun script, rien d'externe. La politique le dit, de sorte qu'une éventuelle
   * faille d'échappement ne suffirait ni à exécuter du code ni à sortir une donnée.
   */
  const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  /** Paramètres de l'adresse (« ?lang=en »), à garder lors d'un renvoi vers une page renommée */
  const queryOf = (req: IncomingMessage) => {
    const url = req.url ?? '';
    const at = url.indexOf('?');
    return at >= 0 && url.length - at <= 300 ? url.slice(at) : '';
  };
  const htmlReply = (html: string, status = 200): Reply => ({
    status,
    raw: Buffer.from(html),
    contentType: 'text/html; charset=utf-8',
    headers: { 'Content-Security-Policy': PAGE_CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
  });

  /* ── Sauvegardes dans l'administration ─────────────────────────────────── */

  const saveSettings = () => writeSetting.run('settings', JSON.stringify(settings));

  /** Santé d'une destination : ce qu'un administrateur doit savoir sans lire de journal */
  const backupView = () => {
    const interval = settings.backup.intervalHours * 3_600_000;
    const list = backup?.destinations() ?? effectiveDestinations(settings.backup).map(d => ({ ...d, state: null }));
    return {
      available: !!backup,
      encrypted: !!process.env.BACKUP_ENCRYPTION_KEY,
      enabled: settings.backup.enabled,
      intervalHours: settings.backup.intervalHours,
      retentionDays: settings.backup.retentionDays,
      running: backup?.isRunning() ?? false,
      destinations: list.map(d => {
        const state = d.state;
        const health = d.status !== 'active' ? d.status
          : !state?.lastSuccessAt ? (state?.lastError ? 'error' : 'never')
          : state.lastErrorAt && state.lastErrorAt > state.lastSuccessAt ? 'error'
          : now() - state.lastSuccessAt > 2 * interval ? 'late' : 'ok';
        const full = d.quotaBytes && state?.usedBytes ? state.usedBytes / d.quotaBytes : null;
        return {
          id: d.id, name: d.name, region: d.region, status: d.status, replacedBy: d.replacedBy ?? null, addedAt: d.addedAt,
          endpoint: d.s3.endpoint, bucket: d.s3.bucket, prefix: d.s3.prefix, hasSecret: !!d.s3.secretAccessKey,
          quotaBytes: d.quotaBytes ?? null, usage: full, health, state
        };
      }),
      runs: backup?.history() ?? []
    };
  };

  /** Toute modification passe d'abord l'ancienne destination unique en liste, pour ne pas la perdre */
  const editDestinations = (change: (list: BackupDestination[]) => BackupDestination[]) => {
    const list = effectiveDestinations(settings.backup).map(d => ({ ...d, s3: { ...d.s3 } }));
    settings = { ...settings, backup: { ...settings.backup, s3: null, destinations: change(list) } };
    saveSettings();
  };

  function backupAdminRoutes(): PatternRoute[] {
    const need = () => {
      if (!backup) throw new HttpError(503, 'backup_unavailable', 'Sauvegardes indisponibles sur ce serveur');
      return backup;
    };
    const fail = (code: string, err: unknown) => new HttpError(502, code, err instanceof Error ? err.message : String(err));
    const destinationFields = (body: Record<string, unknown>, previous?: BackupDestination) => {
      const name = String(body.name ?? previous?.name ?? '').trim();
      if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(name)) throw new HttpError(400, 'invalid_name', 'Nom de destination invalide (40 caractères au plus)');
      let s3;
      try {
        s3 = body.s3 === undefined && previous ? previous.s3 : parseS3(body.s3 as never, previous?.s3.secretAccessKey ?? '');
      } catch (err) {
        throw new HttpError(400, 'invalid_s3', err instanceof Error ? err.message : String(err));
      }
      if (!s3 || !s3.accessKeyId || !s3.secretAccessKey) throw new HttpError(400, 'invalid_s3', 'Adresse, bucket, identifiant et secret S3 requis');
      const quotaGb = body.quotaGb === undefined ? (previous?.quotaBytes ? previous.quotaBytes / 1e9 : 0) : Number(body.quotaGb);
      return {
        name,
        region: String(body.region ?? previous?.region ?? s3.region).trim().slice(0, 30) || s3.region,
        s3,
        ...(Number.isFinite(quotaGb) && quotaGb > 0 ? { quotaBytes: Math.round(quotaGb * 1e9) } : {})
      };
    };

    return [
      route('GET', '/api/v1/admin/backup', async req => {
        requireAdmin(req);
        return { status: 200, body: backupView() };
      }),

      route('POST', '/api/v1/admin/backup/run', async req => {
        const admin = requireAdmin(req, 'operate');
        const body = await readJson(req, 1024);
        try {
          const runs = await need().runNow('manual', typeof body.destinationId === 'string' ? body.destinationId : undefined);
          audit('admin.backup_run', { admin: admin.id, ok: runs.filter(r => r.status === 'success').length, failed: runs.filter(r => r.status === 'error').length });
        } catch (err) {
          throw fail('backup_failed', err);
        }
        return { status: 200, body: backupView() };
      }),

      route('POST', '/api/v1/admin/backup/test', async req => {
        const body = await readJson(req, 4096);
        /*
         * Tester une adresse saisie fait sortir le serveur vers elle : c'est réservé au
         * propriétaire, mot de passe reconfirmé, comme l'ajout d'une destination.
         * Le secret enregistré n'est repris que pour la même adresse, le même bucket et
         * la même clé d'accès : jamais pour signer des requêtes vers un autre hôte.
         */
        requireAdmin(req, body.s3 ? 'manage' : 'operate', !!body.s3);
        try {
          if (body.s3) {
            const input = body.s3 as { endpoint?: unknown; bucket?: unknown; accessKeyId?: unknown };
            const saved = typeof body.destinationId === 'string' ? effectiveDestinations(settings.backup).find(d => d.id === body.destinationId) : undefined;
            const same = !!saved && String(input.endpoint ?? '').trim() === saved.s3.endpoint
              && String(input.bucket ?? '').trim() === saved.s3.bucket && String(input.accessKeyId ?? '').trim() === saved.s3.accessKeyId;
            const s3 = parseS3(body.s3 as never, same ? saved!.s3.secretAccessKey : '');
            if (!s3) throw new Error('Adresse et bucket S3 requis');
            await need().testConfig(s3);
          } else {
            await need().test(typeof body.destinationId === 'string' ? body.destinationId : undefined);
          }
        } catch (err) {
          throw fail('backup_test_failed', err);
        }
        return { status: 204 };
      }),

      // Ajouter : la connexion est vérifiée avant d'enregistrer, pour ne pas garder une destination morte
      route('POST', '/api/v1/admin/backup/destinations', async req => {
        const admin = requireAdmin(req, 'manage', true);
        const fields = destinationFields(await readJson(req, 8192));
        try {
          await need().testConfig(fields.s3);
        } catch (err) {
          throw fail('backup_test_failed', err);
        }
        const id = `dst-${randomBytes(6).toString('hex')}`;
        editDestinations(list => [...list, { id, ...fields, status: 'active', addedAt: now() }]);
        audit('admin.backup_destination_added', { admin: admin.id, destination: id });
        return { status: 200, body: backupView() };
      }),

      route('PATCH', '/api/v1/admin/backup/destinations/:id', async (req, params) => {
        const admin = requireAdmin(req, 'manage', true);
        const body = await readJson(req, 8192);
        const current = effectiveDestinations(settings.backup).find(d => d.id === params.id);
        if (!current) throw new HttpError(404, 'not_found', 'Destination de sauvegarde inconnue');
        if (current.status === 'revoked') throw new HttpError(409, 'revoked', 'Une destination révoquée ne se réactive pas : ajoutez-en une nouvelle');
        const patch: Partial<BackupDestination> = {};
        if (body.status !== undefined) {
          if (body.status !== 'active' && body.status !== 'disabled') throw new HttpError(400, 'invalid_status', 'Statut invalide');
          patch.status = body.status;
        }
        if (body.name !== undefined || body.region !== undefined || body.s3 !== undefined || body.quotaGb !== undefined) {
          Object.assign(patch, destinationFields(body, current));
        }
        editDestinations(list => list.map(d => (d.id === params.id ? { ...d, ...patch } : d)));
        audit('admin.backup_destination_updated', { admin: admin.id, destination: params.id });
        return { status: 200, body: backupView() };
      }),

      // Révoquer : les identifiants sont effacés tout de suite, même si l'accès côté S3 reste à retirer
      route('POST', '/api/v1/admin/backup/destinations/:id/revoke', async (req, params) => {
        const admin = requireAdmin(req, 'manage', true);
        const body = await readJson(req, 1024);
        const list = effectiveDestinations(settings.backup);
        if (!list.some(d => d.id === params.id)) throw new HttpError(404, 'not_found', 'Destination de sauvegarde inconnue');
        const replacedBy = typeof body.replacedBy === 'string' && list.some(d => d.id === body.replacedBy && d.status === 'active') ? body.replacedBy : undefined;
        editDestinations(all => all.map(d => (d.id === params.id
          ? { ...d, status: 'revoked', s3: { ...d.s3, secretAccessKey: '' }, ...(replacedBy ? { replacedBy } : {}) }
          : d)));
        audit('admin.backup_destination_revoked', { admin: admin.id, destination: params.id });
        return { status: 200, body: backupView() };
      }),

      route('DELETE', '/api/v1/admin/backup/destinations/:id', async (req, params) => {
        const admin = requireAdmin(req, 'manage', true);
        const target = effectiveDestinations(settings.backup).find(d => d.id === params.id);
        if (!target) throw new HttpError(404, 'not_found', 'Destination de sauvegarde inconnue');
        if (target.status !== 'revoked') throw new HttpError(409, 'not_revoked', 'Révoquez d’abord la destination');
        editDestinations(list => list.filter(d => d.id !== params.id));
        audit('admin.backup_destination_removed', { admin: admin.id, destination: params.id });
        return { status: 200, body: backupView() };
      }),

      route('GET', '/api/v1/admin/backup/destinations/:id/points', async (req, params) => {
        requireAdmin(req, 'manage');
        try {
          return { status: 200, body: { points: await need().restorePoints(params.id) } };
        } catch (err) {
          throw fail('backup_list_failed', err);
        }
      }),

      route('POST', '/api/v1/admin/backup/restore/preview', async req => {
        requireAdmin(req, 'manage', true);
        const body = await readJson(req, 4096);
        try {
          return { status: 200, body: await need().preview(String(body.destinationId ?? ''), String(body.key ?? '')) };
        } catch (err) {
          throw fail('restore_preview_failed', err);
        }
      }),

      route('POST', '/api/v1/admin/backup/restore/account', async req => {
        const admin = requireAdmin(req, 'manage', true);
        const body = await readJson(req, 4096);
        try {
          const result = await need().restoreAccount(String(body.token ?? ''), String(body.email ?? ''));
          audit('admin.restore_account', { admin: admin.id });
          return { status: 200, body: result };
        } catch (err) {
          throw fail('restore_failed', err);
        }
      }),

      // Restauration du serveur : confirmation écrite en plus de la reconfirmation du mot de passe
      route('POST', '/api/v1/admin/backup/restore/server', async req => {
        const admin = requireAdmin(req, 'manage', true);
        const body = await readJson(req, 4096);
        if (body.confirm !== 'RESTAURER') throw new HttpError(400, 'confirmation_required', 'Saisissez RESTAURER pour confirmer');
        try {
          const result = await need().restoreServer(String(body.token ?? ''));
          audit('admin.restore_server', { admin: admin.id, accounts: result.accounts });
          return { status: 200, body: result };
        } catch (err) {
          throw fail('restore_failed', err);
        }
      })
    ];
  }

  /* ── Grappe dans l'administration ─────────────────────────────────────── */

  /** Un nœud est « hors ligne » quand sa dernière réplication réussie date de plus de trois cycles */
  /*
   * Adresse IP d'un nœud, pour la vue d'ensemble de l'administration. La
   * résolution est asynchrone : on renvoie ce qu'on sait déjà et on met le cache
   * à jour pour la fois suivante. Une heure de validité suffit, et une panne DNS
   * laisse simplement l'adresse vide.
   */
  const ipCache = new Map<string, { ip: string | null; at: number }>();
  const resolving = new Map<string, Promise<void>>();
  const refreshIp = (host: string): Promise<void> => {
    let pending = resolving.get(host);
    if (!pending) {
      pending = lookup(host, { family: 0 }).then(
        result => { ipCache.set(host, { ip: result.address, at: now() }); },
        () => { ipCache.set(host, { ip: null, at: now() }); }
      ).finally(() => { resolving.delete(host); });
      resolving.set(host, pending);
    }
    return pending;
  };
  const hostIp = (host: string): string | null => {
    if (isIP(host)) return host;
    const known = ipCache.get(host);
    if (!known || now() - known.at >= 3_600_000) void refreshIp(host);
    return known?.ip ?? null;
  };
  /** Attend un court instant les adresses jamais résolues : la carte est juste dès sa première ouverture */
  const warmHosts = async (hosts: string[]) => {
    const missing = [...new Set(hosts)].filter(h => h && !isIP(h) && !ipCache.has(h));
    if (missing.length) await Promise.race([Promise.all(missing.map(refreshIp)), new Promise(r => setTimeout(r, 1500))]);
  };

  /** Emplacement de ce serveur, réglé dans l'administration (prioritaire sur l'adresse IP) */
  const storedPlace = (): Place | null => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'server_place'").get() as { value: string } | undefined;
    try { return row ? parsePlace(JSON.parse(row.value)) : null; } catch { return null; }
  };
  /*
   * Position d'un serveur sur la carte : celle réglée à la main d'abord, puis
   * celle de son adresse IP. Sans position, la raison est donnée : adresse d'un
   * relais (Cloudflare…), adresse locale, nom non résolu, ou base GeoIP absente.
   */
  const locate = (host: string, manual: Place | null | undefined) => {
    if (manual) return { place: { lat: manual.lat, lon: manual.lon, city: manual.label, country: '', source: 'manual' as const }, why: null, ip: host ? hostIp(host) : null };
    const ip = host ? hostIp(host) : null;
    if (!ip) return { place: null, why: host ? 'unresolved' : 'no-url', ip };
    const kind = addressKind(ip);
    if (kind) return { place: null, why: kind, ip };
    const geo = options.geo?.lookup(ip) ?? null;
    if (!geo || typeof geo.lat !== 'number' || typeof geo.lon !== 'number') return { place: null, why: 'no-geo', ip };
    return { place: { lat: Math.round(geo.lat * 10) / 10, lon: Math.round(geo.lon * 10) / 10, country: geo.country, city: geo.city, source: 'ip' as const }, why: null, ip };
  };
  const publicHost = () => {
    try { return settings.publicUrl ? new URL(settings.publicUrl).hostname : ''; } catch { return ''; }
  };

  /** `detailed` : adresse IP et message d'erreur brut ne sortent que pour qui opère la grappe */
  const clusterView = (detailed = true) => {
    const snapshot = trust.snapshot();
    const interval = options.clusterIntervalMs ?? 30_000;
    const peers = new Map(cluster.status().map(p => [p.id, p]));
    return {
      ...snapshot,
      cluster: snapshot.cluster ? {
        ...snapshot.cluster,
        nodes: snapshot.cluster.nodes.map(node => {
          const peer = peers.get(node.id);
          const lag = peer && peer.head !== null ? Math.max(0, peer.head - peer.cursor) : null;
          const health = node.self ? 'self'
            : node.status !== 'active' ? node.status
            : node.zone !== snapshot.self.zone ? 'other-zone'
            : !peer?.lastOkAt ? (peer?.lastError ? 'error' : 'unknown')
            : peer.lastError ? 'error'
            : now() - peer.lastOkAt > 3 * interval ? 'offline' : 'ok';
          const host = (() => {
            try {
              return new URL(node.url).host;
            } catch {
              return node.url;
            }
          })();
          // Position pour la carte : réglée à la main, sinon la ville de l'adresse IP du nœud
          const { place, why, ip } = locate(host.split(':')[0].replace(/^\[|\]$/g, ''), node.place ?? (node.self ? storedPlace() : null));
          return {
            ...node, health, lag, host, place, placeWhy: why,
            ip: detailed ? ip : null,
            lastOkAt: peer?.lastOkAt ?? null,
            lastError: detailed ? peer?.lastError ?? null : peer?.lastError ? 'error' : null,
            lastErrorAt: peer?.lastErrorAt ?? null
          };
        })
      } : null,
      pendingConflicts: clusterReady() ? (db.prepare('SELECT COUNT(*) AS n FROM vault_conflicts').get() as { n: number }).n : 0,
      // Ce serveur, même seul : l'emplacement réglé, sinon celui de son adresse publique
      ...(() => {
        const host = publicHost().replace(/^\[|\]$/g, '');
        const { place, why } = locate(host, storedPlace());
        return { selfPlace: place ? { ...place, host } : null, selfPlaceWhy: why, selfPlaceManual: storedPlace() };
      })()
    };
  };
  /** Adresses à résoudre pour la carte : ce serveur et les nœuds du manifeste */
  const mapHosts = () => [publicHost(), ...(trust.snapshot().cluster?.nodes ?? []).map(n => {
    try { return new URL(n.url).hostname; } catch { return ''; }
  })].map(h => h.replace(/^\[|\]$/g, ''));

  function clusterAdminRoutes(): PatternRoute[] {
    const act = (method: string, path: string, run: (req: IncomingMessage, params: Record<string, string>, body: Record<string, unknown>) => Promise<unknown> | unknown, type: string) =>
      route(method, path, async (req, params) => {
        const admin = requireAdmin(req, 'manage', true);
        const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(req, 64 * 1024);
        const result = await run(req, params, body);
        audit(type, { admin: admin.id, ...(params.id ? { node: params.id } : {}) });
        return result === undefined ? { status: 200, body: clusterView() } : { status: 200, body: result };
      });
    return [
      route('GET', '/api/v1/admin/cluster', async req => {
        const admin = requireAdmin(req, 'view');
        await warmHosts(mapHosts());
        // Un rôle en lecture seule voit l'état, pas la topologie réseau détaillée
        return { status: 200, body: clusterView(admin.role !== 'viewer') };
      }),
      /*
       * Emplacement de ce serveur pour la carte, réglé à la main : la
       * géolocalisation de l'adresse IP se trompe derrière un relais
       * (Cloudflare, tunnel). null l'efface.
       */
      route('PUT', '/api/v1/admin/place', async req => {
        const admin = requireAdmin(req, 'manage', true);
        const body = await readJson(req, 4096);
        if (body.place === null) {
          db.prepare("DELETE FROM settings WHERE key = 'server_place'").run();
        } else {
          const place = parsePlace(body.place);
          if (!place) throw new HttpError(400, 'invalid_place', 'Emplacement invalide : latitude entre -90 et 90, longitude entre -180 et 180');
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('server_place', ?)").run(JSON.stringify(place));
        }
        audit('admin.place_updated', { admin: admin.id, cleared: body.place === null });
        await warmHosts(mapHosts());
        return { status: 200, body: clusterView() };
      }),
      act('POST', '/api/v1/admin/cluster', async (_r, _p, body) => { await trust.actions.create(body); }, 'cluster.created'),
      act('POST', '/api/v1/admin/cluster/invites', () => trust.actions.invite(), 'cluster.invite_created'),
      act('POST', '/api/v1/admin/cluster/join', async (_r, _p, body) => { await trust.actions.join(body); }, 'cluster.join_sent'),
      act('POST', '/api/v1/admin/cluster/requests/:id/approve', async (_r, p) => { await trust.actions.approve(p.id); }, 'cluster.node_approved'),
      act('POST', '/api/v1/admin/cluster/requests/:id/reject', (_r, p) => { trust.actions.reject(p.id); }, 'cluster.node_rejected'),
      act('PATCH', '/api/v1/admin/cluster/nodes/:id', async (_r, p, body) => { await trust.actions.update(p.id, body); }, 'cluster.node_updated'),
      act('POST', '/api/v1/admin/cluster/nodes/:id/revoke', async (_r, p, body) => {
        await trust.actions.revoke(p.id, typeof body.replacedBy === 'string' ? body.replacedBy : undefined);
      }, 'cluster.node_revoked'),
      act('DELETE', '/api/v1/admin/cluster/nodes/:id', async (_r, p) => { await trust.actions.remove(p.id); }, 'cluster.node_removed'),
      act('POST', '/api/v1/admin/cluster/node-key/rotate', () => trust.actions.rotateNodeKey(), 'cluster.node_key_rotated'),
      act('POST', '/api/v1/admin/cluster/root-key/rotate', () => trust.actions.rotateRootKey(), 'cluster.root_key_rotated'),
      act('POST', '/api/v1/admin/cluster/root-key/export', (_r, _p, body) => trust.actions.exportRoot(String(body.passphrase ?? '')), 'cluster.root_key_exported'),
      act('POST', '/api/v1/admin/cluster/root-key/import', async (_r, _p, body) => {
        await trust.actions.importRoot((body.backup ?? {}) as Record<string, unknown>, String(body.passphrase ?? ''));
      }, 'cluster.root_key_imported'),
      act('POST', '/api/v1/admin/cluster/leave', () => { trust.actions.leave(); }, 'cluster.left')
    ];
  }

  const patternRoutes: PatternRoute[] = [
    ...trust.nodeRoutes,
    ...clusterRoutes({ db, auth: trust, filesDir: options.filesDir ?? null }),
    ...clusterAdminRoutes(),
    ...backupAdminRoutes(),
    /* ── Langues ajoutées ──────────────────────────────────────────────
       Lecture publique : l'application en a besoin avant toute connexion.
       Ce sont des textes d'interface, pas des données de compte. */
    route('GET', '/api/v1/i18n/:code', async (_req, params) => {
      const pack = languages.get(params.code);
      if (!pack) throw new HttpError(404, 'not_found', 'Langue introuvable');
      return { status: 200, body: { code: pack.code, name: pack.name, strings: pack.strings, updatedAt: pack.updatedAt } };
    }),
    route('PUT', '/api/v1/admin/i18n/:code', async (req, params) => {
      requireAdmin(req, 'manage');
      // Un dictionnaire de 900 textes tient largement dans 1 Mo
      const body = await readJson(req, 1_048_576);
      try {
        const result = languages.save(params.code, body.name, body.strings);
        audit('admin.language_saved', { code: result.pack.code, count: result.pack.count, rejected: result.rejected });
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof LanguageError) throw new HttpError(400, 'bad_language', err.message);
        throw err;
      }
    }),
    route('DELETE', '/api/v1/admin/i18n/:code', async (req, params) => {
      requireAdmin(req, 'manage');
      if (!languages.remove(params.code)) throw new HttpError(404, 'not_found', 'Langue introuvable');
      audit('admin.language_removed', { code: params.code });
      return { status: 204 };
    }),
    route('PATCH', '/api/v1/admin/accounts/:id', async (req, params) => adminAuth.updateAccount(req, params.id, 'PATCH')),
    route('DELETE', '/api/v1/admin/accounts/:id', async (req, params) => adminAuth.updateAccount(req, params.id, 'DELETE')),
    ...sharingRoutes(context),
    ...attachmentRoutes(context),
    /* ── Clés de sécurité ── */
    route('POST', '/api/v1/accounts/security-keys/options', async req => {
      const { userId } = authenticate(req);
      limit(req, 'password');
      const body = await readJson(req, 4096);
      const user = getUser(userId);
      if (!(await verifyAuthHash(user, parseBase64(body.authHash, 'authHash', { exact: 32 })))) {
        throw new HttpError(403, 'invalid_credentials', 'Mot de passe principal incorrect');
      }
      return { status: 200, body: webauthn.registrationOptions(userId, user.email, parseRpId(body.rpId)) };
    }),
    route('POST', '/api/v1/accounts/security-keys', async req => {
      const { userId } = authenticate(req);
      limit(req, 'password');
      const body = await readJson(req, 32768);
      const key = webauthn.register(userId, body as never);
      const user = getUser(userId);
      notify('twoFactor', ctx => emails.twoFactor(ctx, now(), true), user, 'security_key_added');
      audit('account.security_key_added', { rpId: key.rpId }, userId);
      return { status: 201, body: key };
    }),
    route('DELETE', '/api/v1/accounts/security-keys/:id', async (req, params) => {
      const { userId } = authenticate(req);
      limit(req, 'password');
      const body = await readJson(req, 4096);
      const user = getUser(userId);
      if (!(await verifyAuthHash(user, parseBase64(body.authHash, 'authHash', { exact: 32 })))) {
        throw new HttpError(403, 'invalid_credentials', 'Mot de passe principal incorrect');
      }
      if (!webauthn.remove(userId, params.id)) throw new HttpError(404, 'not_found', 'Clé de sécurité inconnue');
      notify('twoFactor', ctx => emails.twoFactor(ctx, now(), false), user, 'security_key_removed');
      audit('account.security_key_removed', {}, userId);
      return { status: 204 };
    }),
    route('GET', '/security/not-me/:token', async (_req, params) => {
      const alert = alertByToken(params.token);
      return alert ? htmlReply(renderNotMePage(alert.kind, params.token)) : htmlReply(renderNotMeExpired(), 410);
    }),
    route('POST', '/security/not-me/:token', async (req, params) => {
      limit(req, 'recovery');
      const alert = alertByToken(params.token);
      if (!alert) return htmlReply(renderNotMeExpired(), 410);

      // Le jeton est consommé d'abord : deux clics simultanés ne doivent pas agir deux fois
      const consumed = sql.useSecurityAlert.run(now(), alert.token_hash);
      if (Number(consumed.changes) === 0) return htmlReply(renderNotMeExpired(), 410);

      sql.deleteAllSessions.run(alert.user_id);
      sql.deleteEmailCode.run(alert.user_id);
      sql.deleteRecoveryTokens.run(alert.user_id);
      audit('account.sessions_revoked_by_alert', { kind: alert.kind }, alert.user_id);
      return htmlReply(renderNotMeDone());
    }),
    route('GET', '/legal', async req => legalPage('privacy', req)),
    // La documentation est servie depuis les fichiers Markdown, sans générateur
    {
      method: 'GET',
      // Le groupe capture toujours (quitte à être vide) : le routeur décode match[1]
      pattern: /^\/docs\/?(.*)$/,
      keys: ['page'],
      handler: async (req: IncomingMessage, params: Record<string, string>): Promise<Reply> => {
        const page = (params.page ?? '').replace(/\/$/, '');
        // Anciennes adresses françaises : renvoi permanent vers la page renommée
        const moved = legacyDocPath(page);
        if (moved) return { status: 301, headers: { Location: `/docs/${moved}${queryOf(req)}` } };
        const { locale, cookie } = pageLocale(req);
        const html = renderDocPage(page, {
          root: docsDir,
          locale,
          appAvailable: !!options.appAvailable,
          chrome: await siteChrome(req)
        });
        return withCookie(html ? htmlReply(html) : htmlReply('<!DOCTYPE html><title>404</title><p>Not found</p>', 404), cookie);
      }
    },

    /*
     * Page d'accueil à la racine. Quand l'hébergeur l'a coupée, la racine mène
     * directement à l'application ; l'ancienne adresse /about renvoie ici.
     */
    route('GET', '/', async req => {
      const page = settings.publicPage ?? DEFAULT_PUBLIC_PAGE;
      if (!page.landingEnabled) return { status: 302, headers: { Location: '/app' } };
      const { ctx, cookie } = await landingContext(req);
      return withCookie(htmlReply(renderLanding(ctx)), cookie);
    }),
    route('GET', '/about', async () => ({ status: 301, headers: { Location: '/' } })),
    /*
     * Bouton de thème sans script : retient le choix un an et ramène à la page.
     * Le retour n'accepte qu'un chemin de ce serveur (pas « //ailleurs »).
     */
    route('GET', '/theme', async req => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const set = url.searchParams.get('set');
      const asked = String(url.searchParams.get('back') ?? '/');
      const back = /^\/(?![/\\])[^\s]{0,300}$/.test(asked) ? asked : '/';
      const cookie = set === 'light' || set === 'dark'
        ? `bv_theme=${set}; Path=/; Max-Age=31536000; SameSite=Lax`
        : 'bv_theme=; Path=/; Max-Age=0; SameSite=Lax';
      return { status: 303, headers: { Location: back, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } };
    }),
    // Anciennes adresses françaises des pages publiques, gardées pour les liens partagés
    ...([['/serveurs', '/servers'], ['/tarifs', '/pricing'], ['/telecharger', '/download']] as const).map(([from, to]) =>
      route('GET', from, async req => ({ status: 301, headers: { Location: to + queryOf(req) } }))),
    // Serveurs recommandés par l'hébergeur (annuaire) ; absente si l'annuaire est coupé
    route('GET', '/servers', async req => {
      const { ctx, cookie } = await landingContext(req);
      const html = renderServersPage(ctx);
      return withCookie(html ? htmlReply(html) : htmlReply('<!DOCTYPE html><title>404</title><p>Not found</p>', 404), cookie);
    }),
    // Offres payantes ; absente tant qu'aucune n'est publiée
    route('GET', '/pricing', async req => {
      const { ctx, cookie } = await landingContext(req);
      const html = renderPlansPage(ctx);
      return withCookie(html ? htmlReply(html) : htmlReply('<!DOCTYPE html><title>404</title><p>Not found</p>', 404), cookie);
    }),
    // Où télécharger ou installer BetterVault, plateforme par plateforme
    route('GET', '/download', async req => {
      const { ctx, cookie } = await landingContext(req);
      githubRepo = ctx.links?.github ?? '';
      return withCookie(htmlReply(renderDownloadsPage({ ...ctx, release: await latestRelease() })), cookie);
    }),
    // Script des pages publiques : du confort (apparitions, démonstrations), jamais indispensable
    route('GET', '/site.js', async () => ({
      status: 200, raw: Buffer.from(SITE_JS), contentType: 'text/javascript; charset=utf-8',
      headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }
    })),
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
          // Un « % » isolé dans l'adresse fait échouer le décodage : requête invalide, pas panne
          let params: Record<string, string>;
          try {
            params = Object.fromEntries(candidate.keys.map((key, i) => [key, decodeURIComponent(match[i + 1] ?? '')]));
          } catch {
            throw new HttpError(400, 'invalid_request', 'Adresse mal encodée');
          }
          matched = { run: candidate.handler, params };
          break;
        }
        if (!matched) throw new HttpError(404, 'not_found', 'Route inconnue');
        reply = await matched.run(req, matched.params);
      }
      if (reply.raw) {
        res.writeHead(reply.status, { ...reply.headers, 'Content-Type': reply.contentType ?? 'application/octet-stream', 'Content-Length': reply.raw.length }).end(reply.raw);
      } else if (reply.status >= 300 && reply.status < 400 && reply.headers?.Location) {
        // Redirection : l'en-tête suffit, pas de corps
        res.writeHead(reply.status, { ...reply.headers, 'Cache-Control': 'no-store' }).end();
      } else {
        for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
        send(res, reply.status, reply.body);
      }
    } catch (err) {
      const locale = requestLocale(req);
      if (err instanceof HttpError) {
        if (err instanceof RateLimitError) res.setHeader('Retry-After', String(err.retryAfterSeconds));
        send(res, err.status, { error: { code: err.code, message: localizeMessage(err.message, locale), ...(err.details === undefined ? {} : { details: err.details }) } });
      } else {
        console.error(err);
        send(res, 500, { error: { code: 'internal', message: localizeMessage('Erreur interne du serveur', locale) } });
      }
    }
  };

  if (options.clusterAutoStart !== false) cluster.start();
  return Object.assign(handler, {
    close: () => {
      backup?.stop();
      cluster.stop();
    },
    cluster
  });
}
