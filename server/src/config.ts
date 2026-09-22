import type { SmtpConfig, SmtpSecurity } from './mailer.ts';
import type { BackupDestination, BackupSettings } from './backup.ts';
import type { S3Config } from './s3.ts';
import { billingFromEnv, DEFAULT_BILLING, parseBillingUpdate, publicBilling, type BillingSettings } from './billing.ts';
import { DEFAULT_LEGAL, legalFromEnv, parseLegalUpdate, type LegalSettings } from './legal.ts';
import { DEFAULT_PUBLIC_PAGE, parsePublicPage, type PublicPageSettings } from './directory.ts';
import { avatarsFromEnv, DEFAULT_AVATARS, parseAvatarUpdate, type AvatarSettings } from './avatars.ts';

/**
 * Réglages du serveur : valeurs du .env, modifiables ensuite depuis la page d'administration.
 *
 * Le coffre est chiffré de bout en bout : le serveur ne peut vérifier que sa taille.
 * Les autres limites sont transmises aux applications, qui les appliquent avant de chiffrer.
 */

export interface ServerLimits {
  maxVaults: number;
  maxCredentialsPerVault: number;
  maxTasksPerVault: number;
  maxTitleLength: number;
  maxUsernameLength: number;
  maxPasswordLength: number;
  maxUrlLength: number;
  maxNoteLength: number;
  maxCustomFields: number;
  maxTagsPerItem: number;
  /** Taille maximale du coffre chiffré stocké sur le serveur */
  maxVaultBytes: number;
  /** Taille maximale d'une pièce jointe */
  maxAttachmentBytes: number;
  /** Espace de pièces jointes par compte */
  attachmentQuotaBytes: number;
  /** Types de coffres personnalisés par compte */
  maxVaultTypes: number;
  maxMembersPerSharedVault: number;
  maxRolesPerSharedVault: number;
  /** Taille maximale d'une photo de profil envoyée */
  maxAvatarBytes: number;
}

export interface ServerSettings {
  limits: ServerLimits;
  /** Inscription de nouveaux comptes autorisée */
  registrationOpen: boolean;
  /**
   * Fichiers joints stockés sur ce serveur. Désactivé, l'envoi est refusé et
   * l'application garde les petits fichiers dans le coffre chiffré lui-même.
   */
  attachmentsEnabled: boolean;
  /** Adresse publique de l'application, utilisée dans les emails */
  publicUrl: string;
  smtp: SmtpConfig | null;
  backup: BackupSettings;
  billing: BillingSettings;
  legal: LegalSettings;
  /** Page d'accueil publique (/about) et annuaire de serveurs proposé à l'application */
  publicPage?: PublicPageSettings;
  avatars: AvatarSettings;
}

const MB = 1024 * 1024;

export const DEFAULT_LIMITS: ServerLimits = {
  maxVaults: 20,
  maxCredentialsPerVault: 5000,
  maxTasksPerVault: 5000,
  maxTitleLength: 200,
  maxUsernameLength: 500,
  maxPasswordLength: 1000,
  maxUrlLength: 2048,
  maxNoteLength: 20000,
  maxCustomFields: 50,
  maxTagsPerItem: 20,
  maxVaultBytes: 20 * MB,
  maxAttachmentBytes: 25 * MB,
  attachmentQuotaBytes: 500 * MB,
  maxVaultTypes: 20,
  maxMembersPerSharedVault: 50,
  maxRolesPerSharedVault: 30,
  maxAvatarBytes: 512 * 1024
};

/** Variables d'environnement ; celles en Mo sont converties en octets */
const LIMIT_ENV: Record<keyof ServerLimits, string> = {
  maxVaults: 'LIMIT_MAX_VAULTS',
  maxCredentialsPerVault: 'LIMIT_MAX_CREDENTIALS_PER_VAULT',
  maxTasksPerVault: 'LIMIT_MAX_TASKS_PER_VAULT',
  maxTitleLength: 'LIMIT_MAX_TITLE_LENGTH',
  maxUsernameLength: 'LIMIT_MAX_USERNAME_LENGTH',
  maxPasswordLength: 'LIMIT_MAX_PASSWORD_LENGTH',
  maxUrlLength: 'LIMIT_MAX_URL_LENGTH',
  maxNoteLength: 'LIMIT_MAX_NOTE_LENGTH',
  maxCustomFields: 'LIMIT_MAX_CUSTOM_FIELDS',
  maxTagsPerItem: 'LIMIT_MAX_TAGS_PER_ITEM',
  maxVaultBytes: 'LIMIT_MAX_VAULT_MB',
  maxAttachmentBytes: 'LIMIT_MAX_ATTACHMENT_MB',
  attachmentQuotaBytes: 'LIMIT_ATTACHMENT_QUOTA_MB',
  maxVaultTypes: 'LIMIT_MAX_VAULT_TYPES',
  maxMembersPerSharedVault: 'LIMIT_MAX_MEMBERS_PER_SHARED_VAULT',
  maxRolesPerSharedVault: 'LIMIT_MAX_ROLES_PER_SHARED_VAULT',
  maxAvatarBytes: 'LIMIT_MAX_AVATAR_KB'
};

type Env = Record<string, string | undefined>;

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} doit être un entier positif (valeur reçue : « ${value} »)`);
  return n;
}

export function limitsFromEnv(env: Env): ServerLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(LIMIT_ENV) as Array<keyof ServerLimits>) {
    const name = LIMIT_ENV[key];
    limits[key] = name.endsWith('_MB')
      ? positiveInt(env[name], DEFAULT_LIMITS[key] / MB, name) * MB
      : name.endsWith('_KB')
        ? positiveInt(env[name], DEFAULT_LIMITS[key] / 1024, name) * 1024
        : positiveInt(env[name], DEFAULT_LIMITS[key], name);
  }
  return limits;
}

export function smtpFromEnv(env: Env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const security = (env.SMTP_SECURITY?.trim() || 'starttls') as SmtpSecurity;
  if (!['tls', 'starttls', 'none'].includes(security)) throw new Error('SMTP_SECURITY doit valoir tls, starttls ou none');
  const from = env.SMTP_FROM?.trim() || env.SMTP_USER?.trim() || '';
  if (!from) throw new Error('SMTP_FROM est requis quand SMTP_HOST est défini');
  return {
    host,
    port: positiveInt(env.SMTP_PORT, security === 'tls' ? 465 : 587, 'SMTP_PORT'),
    security,
    user: env.SMTP_USER?.trim() ?? '',
    password: env.SMTP_PASSWORD ?? '',
    from,
    allowInvalidCertificate: env.SMTP_ALLOW_INVALID_CERT === 'true'
  };
}

export function s3FromEnv(env: Env): S3Config | null {
  const endpoint = env.BACKUP_S3_ENDPOINT?.trim();
  const bucket = env.BACKUP_S3_BUCKET?.trim();
  if (!endpoint || !bucket) return null;
  try {
    new URL(endpoint);
  } catch {
    throw new Error('BACKUP_S3_ENDPOINT doit être une adresse complète, ex. http://minio:9000');
  }
  return {
    endpoint,
    region: env.BACKUP_S3_REGION?.trim() || 'us-east-1',
    bucket,
    accessKeyId: env.BACKUP_S3_ACCESS_KEY?.trim() ?? '',
    secretAccessKey: env.BACKUP_S3_SECRET_KEY ?? '',
    prefix: env.BACKUP_S3_PREFIX?.trim() ?? '',
    pathStyle: env.BACKUP_S3_PATH_STYLE !== 'false'
  };
}

export function settingsFromEnv(env: Env): ServerSettings {
  return {
    limits: limitsFromEnv(env),
    registrationOpen: env.REGISTRATION_OPEN !== 'false',
    attachmentsEnabled: env.ATTACHMENTS_ENABLED !== 'false',
    publicUrl: env.PUBLIC_URL?.trim().replace(/\/+$/, '') ?? '',
    smtp: smtpFromEnv(env),
    backup: {
      enabled: env.BACKUP_ENABLED === 'true',
      intervalHours: positiveInt(env.BACKUP_INTERVAL_HOURS, 24, 'BACKUP_INTERVAL_HOURS'),
      retentionDays: positiveInt(env.BACKUP_RETENTION_DAYS, 30, 'BACKUP_RETENTION_DAYS'),
      s3: s3FromEnv(env)
    },
    billing: billingFromEnv(env),
    legal: legalFromEnv(env),
    publicPage: { ...DEFAULT_PUBLIC_PAGE, landingEnabled: env.LANDING_ENABLED !== 'false' },
    avatars: avatarsFromEnv(env)
  };
}

const int = (value: unknown, name: string, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${name} invalide`);
  return value as number;
};

/** Valide des réglages envoyés par la page d'administration */
/** Configuration S3 validée ; un secret absent reprend celui déjà enregistré */
export function parseS3(input: Partial<S3Config> | null | undefined, previousSecret = ''): S3Config | null {
  if (!input || typeof input !== 'object') return null;
  const endpoint = String(input.endpoint ?? '').trim();
  const bucket = String(input.bucket ?? '').trim();
  if (!endpoint || !bucket) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Adresse S3 invalide');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Adresse S3 invalide');
  return {
    endpoint,
    bucket,
    region: String(input.region ?? '').trim() || 'us-east-1',
    accessKeyId: String(input.accessKeyId ?? '').trim(),
    secretAccessKey: input.secretAccessKey ? String(input.secretAccessKey) : previousSecret,
    prefix: String(input.prefix ?? '').trim(),
    pathStyle: input.pathStyle !== false
  };
}

const DEST_ID = /^dst-[a-z0-9-]{1,40}$/;
const DEST_NAME = /^[\p{L}\p{N} ._-]{1,40}$/u;

/** Destinations de sauvegarde relues depuis le stockage des réglages */
function parseDestinations(input: unknown, previous: BackupDestination[] = []): BackupDestination[] {
  if (!Array.isArray(input)) return previous;
  return input.slice(0, 10).flatMap((raw): BackupDestination[] => {
    const d = raw as Partial<BackupDestination> & { s3?: Partial<S3Config> };
    if (!d || !DEST_ID.test(String(d.id)) || !DEST_NAME.test(String(d.name ?? ''))) return [];
    const before = previous.find(p => p.id === d.id);
    const s3 = parseS3(d.s3, before?.s3.secretAccessKey ?? '');
    if (!s3) return [];
    const status = d.status === 'disabled' || d.status === 'revoked' ? d.status : 'active';
    return [{
      id: String(d.id),
      name: String(d.name),
      region: String(d.region ?? s3.region).slice(0, 30),
      // Une destination révoquée perd son secret : ses identifiants ne servent plus à rien
      s3: status === 'revoked' ? { ...s3, secretAccessKey: '' } : s3,
      status,
      ...(Number.isFinite(d.quotaBytes) && (d.quotaBytes as number) > 0 ? { quotaBytes: Math.floor(d.quotaBytes as number) } : {}),
      addedAt: Number(d.addedAt) || Date.now(),
      ...(d.replacedBy && DEST_ID.test(String(d.replacedBy)) ? { replacedBy: String(d.replacedBy) } : {})
    }];
  });
}

export function parseSettingsUpdate(input: unknown, current: ServerSettings): ServerSettings {
  const body = (input ?? {}) as Record<string, unknown>;
  const next: ServerSettings = {
    ...current,
    limits: { ...current.limits },
    backup: { ...(current.backup ?? { enabled: false, intervalHours: 24, retentionDays: 30, s3: null }) },
    billing: parseBillingUpdate(body.billing, current.billing ?? DEFAULT_BILLING),
    legal: parseLegalUpdate(body.legal, current.legal ?? DEFAULT_LEGAL),
    avatars: parseAvatarUpdate(body.avatars, current.avatars ?? DEFAULT_AVATARS)
  };

  if (body.limits && typeof body.limits === 'object') {
    for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof ServerLimits>) {
      const value = (body.limits as Record<string, unknown>)[key];
      if (value === undefined) continue;
      next.limits[key] = int(value, `Limite « ${key} »`);
    }
  }
  if (typeof body.registrationOpen === 'boolean') next.registrationOpen = body.registrationOpen;
  if (typeof body.attachmentsEnabled === 'boolean') next.attachmentsEnabled = body.attachmentsEnabled;
  if (body.publicPage !== undefined) next.publicPage = parsePublicPage(body.publicPage, current.publicPage ?? DEFAULT_PUBLIC_PAGE);
  if (typeof body.publicUrl === 'string') next.publicUrl = body.publicUrl.trim().replace(/\/+$/, '');

  if (body.smtp === null) {
    next.smtp = null;
  } else if (body.smtp && typeof body.smtp === 'object') {
    const smtp = body.smtp as Partial<SmtpConfig>;
    const host = String(smtp.host ?? '').trim();
    if (!host) {
      next.smtp = null;
    } else {
      const security = (smtp.security ?? 'starttls') as SmtpSecurity;
      if (!['tls', 'starttls', 'none'].includes(security)) throw new Error('Sécurité SMTP invalide');
      const port = int(Number(smtp.port ?? (security === 'tls' ? 465 : 587)), 'Port SMTP', 1, 65535);
      const from = String(smtp.from ?? '').trim();
      if (!from) throw new Error('Adresse d’expédition requise');
      next.smtp = {
        host,
        port,
        security,
        user: String(smtp.user ?? '').trim(),
        // Mot de passe vide : conserver l'actuel (la page ne le réaffiche jamais)
        password: smtp.password ? String(smtp.password) : current.smtp?.password ?? '',
        from,
        allowInvalidCertificate: smtp.allowInvalidCertificate === true
      };
    }
  }

  if (body.backup && typeof body.backup === 'object') {
    const backup = body.backup as Partial<BackupSettings> & { s3?: Partial<S3Config> | null };
    if (typeof backup.enabled === 'boolean') next.backup.enabled = backup.enabled;
    if (backup.intervalHours !== undefined) next.backup.intervalHours = int(backup.intervalHours, 'Fréquence des sauvegardes', 1, 24 * 30);
    if (backup.retentionDays !== undefined) next.backup.retentionDays = int(backup.retentionDays, 'Durée de conservation', 1, 3650);
    if (backup.s3 === null) {
      next.backup.s3 = null;
    } else if (backup.s3 && typeof backup.s3 === 'object') {
      next.backup.s3 = parseS3(backup.s3, current.backup?.s3?.secretAccessKey ?? '');
    }
    if (backup.destinations !== undefined) {
      next.backup.destinations = parseDestinations(backup.destinations, current.backup?.destinations);
    }
  }
  return next;
}

/** Réglages sans les secrets, pour la page d'administration */
export function publicSettings(settings: ServerSettings): unknown {
  return {
    ...settings,
    smtp: settings.smtp ? { ...settings.smtp, password: '', hasPassword: !!settings.smtp.password } : null,
    backup: {
      ...settings.backup,
      s3: settings.backup?.s3 ? { ...settings.backup.s3, secretAccessKey: '', hasSecret: !!settings.backup.s3.secretAccessKey } : null,
      // Les secrets ne quittent jamais le serveur, même vers l'administration
      destinations: (settings.backup?.destinations ?? []).map(d => ({ ...d, s3: { ...d.s3, secretAccessKey: '', hasSecret: !!d.s3.secretAccessKey } }))
    },
    billing: publicBilling(settings.billing ?? DEFAULT_BILLING)
  };
}
