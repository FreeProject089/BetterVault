import type { MailMessage } from './mailer.ts';

/**
 * Emails envoyés par le serveur.
 *
 * Ils sont rédigés en anglais quelle que soit la langue de l'application. Un email
 * traverse des serveurs, des filtres anti-spam et parfois une boîte partagée : il
 * est lu par des gens et des machines qui ne partagent pas forcément la langue du
 * destinataire, et l'hébergeur d'un serveur BetterVault n'est pas nécessairement
 * francophone. Une seule langue, c'est aussi un seul texte à relire.
 *
 * Chaque message part en deux versions — texte et HTML. Le HTML est écrit à
 * l'ancienne, en tableaux et en styles greffés sur chaque balise : les clients de
 * messagerie ignorent les feuilles de style externes, la mise en page moderne, et
 * bon nombre d'entre eux retirent même la balise `<style>`.
 */

export type Locale = 'fr' | 'en';

export function pickLocale(explicit: unknown, acceptLanguage: string | undefined): Locale {
  if (explicit === 'fr' || explicit === 'en') return explicit;
  return (acceptLanguage ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

export interface EmailContext {
  to: string;
  locale: Locale;
  publicUrl: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/* ── Habillage ──────────────────────────────────────────────────────────── */

const ENCRE = '#1f2328';
const DISCRET = '#656d76';
const BORDURE = '#d8dee4';
const ACCENT = '#5754c7';
const FOND = '#f6f8fa';

/** Le logo en SVG ne passerait pas : beaucoup de clients le bloquent. Un rond suffit. */
const marque = () => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="padding-right:10px;">
        <div style="width:28px;height:28px;line-height:28px;border-radius:8px;background-color:${ACCENT};color:#ffffff;font:700 15px/28px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;">B</div>
      </td>
      <td style="font:600 16px/28px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ENCRE};">BetterVault</td>
    </tr>
  </table>`;

/** Bloc de code : gros, espacé, sélectionnable d'un geste */
const blocCode = (code: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0;">
    <tr>
      <td align="center" style="padding:18px 12px;background-color:${FOND};border:1px solid ${BORDURE};border-radius:10px;
        font:700 30px/1.2 ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;letter-spacing:8px;color:${ENCRE};">
        ${escapeHtml(code)}
      </td>
    </tr>
  </table>`;

/** Liste de faits : ce que le lecteur doit vérifier d'un coup d'œil */
const faits = (lignes: Array<[string, string]>) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;border-collapse:collapse;">
    ${lignes.map(([cle, valeur]) => `
    <tr>
      <td style="padding:7px 12px 7px 0;border-bottom:1px solid ${BORDURE};font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${DISCRET};white-space:nowrap;">${escapeHtml(cle)}</td>
      <td style="padding:7px 0;border-bottom:1px solid ${BORDURE};font:500 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ENCRE};word-break:break-word;">${escapeHtml(valeur)}</td>
    </tr>`).join('')}
  </table>`;

const paragraphe = (texte: string) =>
  `<p style="margin:0 0 14px;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ENCRE};">${texte}</p>`;

/** Ce qu'il faut faire si l'on n'est pas à l'origine de l'événement */
const alerte = (texte: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0 4px;">
    <tr>
      <td style="padding:12px 14px;background-color:#fff8c5;border:1px solid #d4a72c;border-radius:8px;
        font:400 13.5px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#4d2d00;">${texte}</td>
    </tr>
  </table>`;

function page(titre: string, corps: string, publicUrl: string): string {
  const lien = publicUrl
    ? `<a href="${escapeHtml(publicUrl)}" style="color:${ACCENT};text-decoration:none;">${escapeHtml(publicUrl)}</a><br>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(titre)}</title>
</head>
<body style="margin:0;padding:0;background-color:${FOND};">
  <!-- Repris comme aperçu dans la liste des messages, jamais affiché dans le corps -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(titre)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${FOND};">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background-color:#ffffff;border:1px solid ${BORDURE};border-radius:14px;">
          <tr>
            <td style="padding:22px 26px 0;">${marque()}</td>
          </tr>
          <tr>
            <td style="padding:18px 26px 24px;">
              <h1 style="margin:0 0 14px;font:600 20px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ENCRE};">${escapeHtml(titre)}</h1>
              ${corps}
            </td>
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;">
          <tr>
            <td style="padding:16px 26px 0;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${DISCRET};">
              ${lien}You are receiving this email because it concerns the security of your BetterVault account.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const piedTexte = (publicUrl: string) =>
  `\n\n— BetterVault${publicUrl ? `\n${publicUrl}` : ''}\nYou are receiving this email because it concerns the security of your BetterVault account.`;

const message = (ctx: EmailContext, subject: string, texte: string, corpsHtml: string): MailMessage => ({
  to: ctx.to,
  subject,
  text: texte + piedTexte(ctx.publicUrl),
  html: page(subject, corpsHtml, ctx.publicUrl)
});

/* ── Messages ───────────────────────────────────────────────────────────── */

export const emails = {
  resetCode(ctx: EmailContext, code: string, minutes: number): MailMessage {
    return message(
      ctx,
      `BetterVault reset code: ${code}`,
      `Your code: ${code}\n\nIt is valid for ${minutes} minutes.\nIf you did not ask to reset your password, ignore this email: nothing changes without this code.`,
      paragraphe('Use this code to continue resetting your master password.')
        + blocCode(code)
        + paragraphe(`<span style="color:${DISCRET};">It expires in ${minutes} minutes.</span>`)
        + alerte('If you did not ask to reset your password, ignore this email. Nothing changes without this code.')
    );
  },

  newLogin(ctx: EmailContext, when: number, address: string, device: string): MailMessage {
    return message(
      ctx,
      'New sign-in to your BetterVault account',
      `A sign-in happened on ${formatDate(when)}.\nIP address: ${address}\nDevice: ${device || 'unknown'}\n\nIf this wasn't you, change your master password and turn on two-factor authentication.`,
      paragraphe('Someone signed in to your account.')
        + faits([['When', formatDate(when)], ['IP address', address], ['Device', device || 'unknown']])
        + alerte('If this wasn’t you, change your master password and turn on two-factor authentication.')
    );
  },

  passwordChanged(ctx: EmailContext, when: number, viaRecovery: boolean): MailMessage {
    const how = viaRecovery ? ' using account recovery' : '';
    return message(
      ctx,
      'Master password changed',
      `Your account's master password was changed${how} on ${formatDate(when)}.\nOther devices will need to sign in again.\n\nIf this wasn't you, contact the server administrator.`,
      paragraphe(`Your account’s master password was changed${how}.`)
        + faits([['When', formatDate(when)]])
        + paragraphe(`<span style="color:${DISCRET};">Other devices will need to sign in again.</span>`)
        + alerte('If this wasn’t you, contact the administrator of your server.')
    );
  },

  vaultReset(ctx: EmailContext, when: number): MailMessage {
    return message(
      ctx,
      'BetterVault account reset',
      `Your account was reset without a recovery key on ${formatDate(when)}.\nThe previous vault was replaced with an empty one.`,
      paragraphe('Your account was reset without a recovery key.')
        + faits([['When', formatDate(when)]])
        + paragraphe('The previous vault was replaced with an empty one. Its contents cannot be recovered.')
        + alerte('If this wasn’t you, contact the administrator of your server.')
    );
  },

  twoFactor(ctx: EmailContext, when: number, enabled: boolean): MailMessage {
    const etat = enabled ? 'on' : 'off';
    return message(
      ctx,
      `Two-factor authentication turned ${etat}`,
      `Two-factor authentication was turned ${etat} for your account on ${formatDate(when)}.`,
      paragraphe(`Two-factor authentication was turned <strong>${etat}</strong> for your account.`)
        + faits([['When', formatDate(when)]])
        + alerte('If this wasn’t you, change your master password right away.')
    );
  },

  recoveryKeyChanged(ctx: EmailContext, when: number): MailMessage {
    return message(
      ctx,
      'New recovery key',
      `A new recovery key was created on ${formatDate(when)}. The previous one no longer works.`,
      paragraphe('A new recovery key was created for your account.')
        + faits([['When', formatDate(when)]])
        + paragraphe('The previous key no longer works. Keep the new one outside BetterVault.')
        + alerte('If this wasn’t you, contact the administrator of your server.')
    );
  },

  sharedInvite(ctx: EmailContext, inviterEmail: string): MailMessage {
    return message(
      ctx,
      `${inviterEmail} invited you to a shared vault`,
      `${inviterEmail} invited you to a shared BetterVault vault.\nOpen BetterVault, then Shared vaults, to accept or decline.`,
      paragraphe(`<strong>${escapeHtml(inviterEmail)}</strong> invited you to a shared BetterVault vault.`)
        + paragraphe(`<span style="color:${DISCRET};">Open BetterVault, then <strong>Shared vaults</strong>, to accept or decline. Nothing is shared until you accept.</span>`)
    );
  },

  test(to: string, _locale: Locale): MailMessage {
    return message(
      { to, locale: 'en', publicUrl: '' },
      'BetterVault test email',
      'The SMTP settings of your BetterVault server work.',
      paragraphe('The SMTP settings of your BetterVault server work. Nothing else to do.')
    );
  }
};
