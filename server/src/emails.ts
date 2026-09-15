import type { MailMessage } from './mailer.ts';

export type Locale = 'fr' | 'en';

export function pickLocale(explicit: unknown, acceptLanguage: string | undefined): Locale {
  if (explicit === 'fr' || explicit === 'en') return explicit;
  return (acceptLanguage ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const formatDate = (timestamp: number, locale: Locale) =>
  new Date(timestamp).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

const footer = (locale: Locale, publicUrl: string) =>
  `\n\n— BetterVault${publicUrl ? `\n${publicUrl}` : ''}\n${locale === 'fr'
    ? 'Vous recevez cet email car il concerne la sécurité de votre compte.'
    : 'You are receiving this email because it concerns the security of your account.'}`;

export interface EmailContext {
  to: string;
  locale: Locale;
  publicUrl: string;
}

export const emails = {
  resetCode(ctx: EmailContext, code: string, minutes: number): MailMessage {
    const fr = ctx.locale === 'fr';
    return {
      to: ctx.to,
      subject: fr ? `Code de réinitialisation BetterVault : ${code}` : `BetterVault reset code: ${code}`,
      text: (fr
        ? `Votre code : ${code}\n\nIl est valable ${minutes} minutes.\nSi vous n'avez pas demandé à réinitialiser votre mot de passe, ignorez cet email : rien ne change sans ce code.`
        : `Your code: ${code}\n\nIt is valid for ${minutes} minutes.\nIf you did not ask to reset your password, ignore this email: nothing changes without this code.`)
        + footer(ctx.locale, ctx.publicUrl)
    };
  },

  newLogin(ctx: EmailContext, when: number, address: string, device: string): MailMessage {
    const fr = ctx.locale === 'fr';
    return {
      to: ctx.to,
      subject: fr ? 'Nouvelle connexion à votre compte BetterVault' : 'New sign-in to your BetterVault account',
      text: (fr
        ? `Une connexion a eu lieu le ${formatDate(when, 'fr')}.\nAdresse IP : ${address}\nAppareil : ${device || 'inconnu'}\n\nSi ce n'était pas vous, changez votre mot de passe principal et activez la double authentification.`
        : `A sign-in happened on ${formatDate(when, 'en')}.\nIP address: ${address}\nDevice: ${device || 'unknown'}\n\nIf this wasn't you, change your master password and turn on two-factor authentication.`)
        + footer(ctx.locale, ctx.publicUrl)
    };
  },

  passwordChanged(ctx: EmailContext, when: number, viaRecovery: boolean): MailMessage {
    const fr = ctx.locale === 'fr';
    const how = viaRecovery
      ? (fr ? ' par la procédure de récupération' : ' using account recovery')
      : '';
    return {
      to: ctx.to,
      subject: fr ? 'Mot de passe principal modifié' : 'Master password changed',
      text: (fr
        ? `Le mot de passe principal de votre compte a été modifié${how} le ${formatDate(when, 'fr')}.\nLes autres appareils devront se reconnecter.\n\nSi ce n'était pas vous, contactez l'administrateur du serveur.`
        : `Your account's master password was changed${how} on ${formatDate(when, 'en')}.\nOther devices will need to sign in again.\n\nIf this wasn't you, contact the server administrator.`)
        + footer(ctx.locale, ctx.publicUrl)
    };
  },

  vaultReset(ctx: EmailContext, when: number): MailMessage {
    const fr = ctx.locale === 'fr';
    return {
      to: ctx.to,
      subject: fr ? 'Compte BetterVault réinitialisé' : 'BetterVault account reset',
      text: (fr
        ? `Votre compte a été réinitialisé sans clé de secours le ${formatDate(when, 'fr')}.\nL'ancien coffre a été remplacé par un coffre vide.`
        : `Your account was reset without a recovery key on ${formatDate(when, 'en')}.\nThe previous vault was replaced with an empty one.`)
        + footer(ctx.locale, ctx.publicUrl)
    };
  },

  twoFactor(ctx: EmailContext, when: number, enabled: boolean): MailMessage {
    const fr = ctx.locale === 'fr';
    return {
      to: ctx.to,
      subject: fr
        ? (enabled ? 'Double authentification activée' : 'Double authentification désactivée')
        : (enabled ? 'Two-factor authentication turned on' : 'Two-factor authentication turned off'),
      text: (fr
        ? `La double authentification a été ${enabled ? 'activée' : 'désactivée'} sur votre compte le ${formatDate(when, 'fr')}.`
        : `Two-factor authentication was turned ${enabled ? 'on' : 'off'} for your account on ${formatDate(when, 'en')}.`)
        + footer(ctx.locale, ctx.publicUrl)
    };
  },

  recoveryKeyChanged(ctx: EmailContext, when: number): MailMessage {
    const fr = ctx.locale === 'fr';
    return {
      to: ctx.to,
      subject: fr ? 'Nouvelle clé de secours' : 'New recovery key',
      text: (fr
        ? `Une nouvelle clé de secours a été créée le ${formatDate(when, 'fr')}. L'ancienne ne fonctionne plus.`
        : `A new recovery key was created on ${formatDate(when, 'en')}. The previous one no longer works.`)
        + footer(ctx.locale, ctx.publicUrl)
    };
  },

  sharedInvite(ctx: EmailContext, inviterEmail: string): MailMessage {
    const fr = ctx.locale === 'fr';
    return {
      to: ctx.to,
      subject: fr ? `${inviterEmail} vous invite dans un coffre partagé` : `${inviterEmail} invited you to a shared vault`,
      text: (fr
        ? `${inviterEmail} vous a invité dans un coffre BetterVault partagé.\nOuvrez BetterVault, puis Coffres partagés, pour accepter ou refuser.`
        : `${inviterEmail} invited you to a shared BetterVault vault.\nOpen BetterVault, then Shared vaults, to accept or decline.`)
        + footer(ctx.locale, ctx.publicUrl)
    };
  },

  test(to: string, locale: Locale): MailMessage {
    return {
      to,
      subject: locale === 'fr' ? 'Test d’envoi BetterVault' : 'BetterVault test email',
      text: locale === 'fr'
        ? 'La configuration SMTP de votre serveur BetterVault fonctionne.'
        : 'The SMTP settings of your BetterVault server work.'
    };
  }
};
