import type { SmtpConfig, SmtpSecurity } from './mailer.ts';

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
}

export interface ServerSettings {
  limits: ServerLimits;
  /** Inscription de nouveaux comptes autorisée */
  registrationOpen: boolean;
  /** Adresse publique de l'application, utilisée dans les emails */
  publicUrl: string;
  smtp: SmtpConfig | null;
}

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
  maxVaultBytes: 20 * 1024 * 1024
};

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
  maxVaultBytes: 'LIMIT_MAX_VAULT_MB'
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
    if (key === 'maxVaultBytes') {
      limits.maxVaultBytes = positiveInt(env[name], DEFAULT_LIMITS.maxVaultBytes / (1024 * 1024), name) * 1024 * 1024;
    } else {
      limits[key] = positiveInt(env[name], DEFAULT_LIMITS[key], name);
    }
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

export function settingsFromEnv(env: Env): ServerSettings {
  return {
    limits: limitsFromEnv(env),
    registrationOpen: env.REGISTRATION_OPEN !== 'false',
    publicUrl: env.PUBLIC_URL?.trim().replace(/\/+$/, '') ?? '',
    smtp: smtpFromEnv(env)
  };
}

/** Valide des réglages envoyés par la page d'administration */
export function parseSettingsUpdate(input: unknown, current: ServerSettings): ServerSettings {
  const body = (input ?? {}) as Partial<ServerSettings> & { smtp?: Partial<SmtpConfig> | null };
  const next: ServerSettings = { ...current, limits: { ...current.limits } };

  if (body.limits && typeof body.limits === 'object') {
    for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof ServerLimits>) {
      const value = (body.limits as unknown as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`Limite « ${key} » invalide`);
      next.limits[key] = value as number;
    }
  }
  if (typeof body.registrationOpen === 'boolean') next.registrationOpen = body.registrationOpen;
  if (typeof body.publicUrl === 'string') next.publicUrl = body.publicUrl.trim().replace(/\/+$/, '');

  if (body.smtp === null) {
    next.smtp = null;
  } else if (body.smtp && typeof body.smtp === 'object') {
    const smtp = body.smtp;
    const host = String(smtp.host ?? '').trim();
    if (!host) {
      next.smtp = null;
    } else {
      const security = (smtp.security ?? 'starttls') as SmtpSecurity;
      if (!['tls', 'starttls', 'none'].includes(security)) throw new Error('Sécurité SMTP invalide');
      const port = Number(smtp.port ?? (security === 'tls' ? 465 : 587));
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port SMTP invalide');
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
  return next;
}

/** Réglages sans le mot de passe SMTP, pour la page d'administration */
export function publicSettings(settings: ServerSettings): unknown {
  return {
    ...settings,
    smtp: settings.smtp ? { ...settings.smtp, password: '', hasPassword: !!settings.smtp.password } : null
  };
}
