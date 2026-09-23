import type { DatabaseSync } from 'node:sqlite';
import { emails, type EmailContext, type EmailOverride, type Locale } from './emails.ts';
import type { MailMessage } from './mailer.ts';

/**
 * Personnalisation des emails, côté administration.
 *
 * Ce qu'on laisse changer : le **sujet** et un **paragraphe d'introduction**,
 * par message et par langue. Ce qu'on ne laisse pas changer : les faits (code,
 * date, adresse IP), l'avertissement de sécurité et la mise en page. Un
 * gestionnaire de mots de passe envoie des emails de sécurité ; pouvoir en
 * retirer l'avertissement, ou y glisser du HTML, serait une porte ouverte à
 * l'hameçonnage depuis son propre serveur.
 *
 * Tout est rangé dans la table `settings`, sous des clés préfixées.
 */

export const EMAIL_LOCALES: Locale[] = ['fr', 'en'];

/** Longueurs : un sujet tient sur une ligne, une introduction sur un paragraphe */
export const MAX_SUBJECT = 150;
export const MAX_INTRO = 600;

export interface EmailKind {
  id: string;
  /** Nom du message dans l'administration */
  label: [string, string];
  /** Quand il part */
  when: [string, string];
  /** Construit l'exemple affiché en aperçu */
  sample(ctx: EmailContext): MailMessage;
}

const SAMPLE_DATE = Date.UTC(2026, 2, 14, 10, 5);

export const EMAIL_KINDS: EmailKind[] = [
  {
    id: 'resetCode',
    label: ['Code de réinitialisation', 'Reset code'],
    when: ['Mot de passe principal oublié', 'Forgotten master password'],
    sample: ctx => emails.resetCode(ctx, '481 902'.replace(' ', ''), 15)
  },
  {
    id: 'newLogin',
    label: ['Nouvelle connexion', 'New sign-in'],
    when: ['Connexion depuis un appareil inconnu', 'Sign-in from an unknown device'],
    sample: ctx => emails.newLogin(ctx, SAMPLE_DATE, '81.250.12.0 (Lyon, France)', 'Firefox — Windows')
  },
  {
    id: 'passwordChanged',
    label: ['Mot de passe changé', 'Password changed'],
    when: ['Changement du mot de passe principal', 'Master password change'],
    sample: ctx => emails.passwordChanged(ctx, SAMPLE_DATE, false)
  },
  {
    id: 'vaultReset',
    label: ['Compte réinitialisé', 'Account reset'],
    when: ['Réinitialisation sans clé de secours', 'Reset without a recovery key'],
    sample: ctx => emails.vaultReset(ctx, SAMPLE_DATE)
  },
  {
    id: 'twoFactor',
    label: ['Double authentification', 'Two-factor authentication'],
    when: ['Activation ou désactivation', 'Turned on or off'],
    sample: ctx => emails.twoFactor(ctx, SAMPLE_DATE, true)
  },
  {
    id: 'recoveryKeyChanged',
    label: ['Nouvelle clé de secours', 'New recovery key'],
    when: ['Création d’une clé de secours', 'A recovery key is created'],
    sample: ctx => emails.recoveryKeyChanged(ctx, SAMPLE_DATE)
  },
  {
    id: 'sharedInvite',
    label: ['Invitation à un coffre partagé', 'Shared vault invitation'],
    when: ['Invitation envoyée à un compte', 'An account is invited'],
    sample: ctx => emails.sharedInvite(ctx, 'camille@exemple.fr')
  },
  {
    id: 'test',
    label: ['Email de test', 'Test email'],
    when: ['Bouton « Envoyer un test »', '“Send a test” button'],
    sample: ctx => emails.test(ctx.to, ctx.locale, ctx.override)
  }
];

const KIND_IDS = new Set(EMAIL_KINDS.map(k => k.id));

export const isEmailKind = (id: unknown): id is string => typeof id === 'string' && KIND_IDS.has(id);
export const isEmailLocale = (value: unknown): value is Locale => value === 'fr' || value === 'en';

/** Texte propre sur plusieurs lignes : pas de caractère de contrôle, longueur bornée */
const cleanText = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);

/**
 * Sujet : une seule ligne. Un saut de ligne dans un sujet d'email ouvre un
 * nouvel en-tête (« Bcc: … ») : c'est la faille classique d'injection.
 */
const cleanSubject = (value: unknown): string =>
  cleanText(value, MAX_SUBJECT * 2).replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, MAX_SUBJECT);

export interface StoredTemplate {
  subject: string;
  intro: string;
}

export interface EmailSettingsView {
  defaultLocale: Locale;
  locales: Locale[];
  kinds: Array<{
    id: string;
    label: [string, string];
    when: [string, string];
    overrides: Record<string, StoredTemplate>;
  }>;
}

export function createEmailTemplates(db: DatabaseSync) {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?');
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const drop = db.prepare('DELETE FROM settings WHERE key = ?');

  const key = (id: string, locale: Locale) => `email.tpl.${id}.${locale}`;

  const read = (id: string, locale: Locale): StoredTemplate | null => {
    const row = get.get(key(id, locale)) as { value?: string } | undefined;
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value) as Partial<StoredTemplate>;
      const subject = cleanSubject(parsed.subject);
      const intro = cleanText(parsed.intro, MAX_INTRO);
      return subject || intro ? { subject, intro } : null;
    } catch {
      return null;
    }
  };

  return {
    /** Langue d'envoi quand le compte n'en a pas choisi une */
    defaultLocale(): Locale {
      const row = get.get('email.locale.default') as { value?: string } | undefined;
      return isEmailLocale(row?.value) ? row.value : 'en';
    },

    setDefaultLocale(locale: Locale): void {
      put.run('email.locale.default', locale);
    },

    /** Personnalisation à appliquer, ou rien */
    override(id: string, locale: Locale): EmailOverride | undefined {
      const stored = read(id, locale);
      if (!stored) return undefined;
      return {
        ...(stored.subject ? { subject: stored.subject } : {}),
        ...(stored.intro ? { intro: stored.intro } : {})
      };
    },

    save(id: string, locale: Locale, input: { subject?: unknown; intro?: unknown }): StoredTemplate | null {
      const subject = cleanSubject(input.subject);
      const intro = cleanText(input.intro, MAX_INTRO);
      // Tout vide : on retire l'entrée plutôt que de garder une coquille
      if (!subject && !intro) {
        drop.run(key(id, locale));
        return null;
      }
      const value: StoredTemplate = { subject, intro };
      put.run(key(id, locale), JSON.stringify(value));
      return value;
    },

    /** État complet, pour l'écran d'administration */
    view(): EmailSettingsView {
      return {
        defaultLocale: this.defaultLocale(),
        locales: EMAIL_LOCALES,
        kinds: EMAIL_KINDS.map(kind => ({
          id: kind.id,
          label: kind.label,
          when: kind.when,
          overrides: Object.fromEntries(
            EMAIL_LOCALES.map(locale => [locale, read(kind.id, locale) ?? { subject: '', intro: '' }])
          )
        }))
      };
    },

    /**
     * Aperçu d'un message, avec des valeurs d'exemple. Le résultat est le vrai
     * HTML envoyé : c'est tout l'intérêt de l'aperçu.
     */
    preview(id: string, locale: Locale, publicUrl: string, draft?: { subject?: unknown; intro?: unknown }): MailMessage | null {
      const kind = EMAIL_KINDS.find(k => k.id === id);
      if (!kind) return null;
      const override = draft
        ? {
            ...(cleanSubject(draft.subject) ? { subject: cleanSubject(draft.subject) } : {}),
            ...(cleanText(draft.intro, MAX_INTRO) ? { intro: cleanText(draft.intro, MAX_INTRO) } : {})
          }
        : this.override(id, locale);
      return kind.sample({
        to: locale === 'fr' ? 'camille@exemple.fr' : 'alex@example.com',
        locale,
        publicUrl,
        // Le lien à usage unique n'existe pas pour un aperçu : on montre le bouton
        // avec une adresse d'exemple, pour que la mise en page soit fidèle.
        notMeUrl: publicUrl ? `${publicUrl.replace(/\/+$/, '')}/alerte/exemple` : undefined,
        override
      });
    }
  };
}

export type EmailTemplates = ReturnType<typeof createEmailTemplates>;
