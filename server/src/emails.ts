import type { MailMessage } from './mailer.ts';

/**
 * Emails envoyés par le serveur.
 *
 * Ils partent dans la langue du compte, ou à défaut dans la langue choisie par
 * l'administration du serveur (voir `emailTemplates.ts`). Les faits — code,
 * date, adresse IP — et l'avertissement de sécurité sont toujours produits par
 * le serveur : une personnalisation ne peut ni les retirer ni les déformer.
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

/** Le mot juste selon la langue, sans table de traduction pour si peu de textes */
const t = (locale: Locale, fr: string, en: string) => (locale === 'fr' ? fr : en);

const formatDate = (timestamp: number, locale: Locale = 'en') =>
  new Date(timestamp).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

/** Personnalisation posée par l'administration : du texte, jamais du HTML */
export interface EmailOverride {
  subject?: string;
  /** Paragraphe d'introduction ajouté en tête du message */
  intro?: string;
}

export interface EmailContext {
  to: string;
  locale: Locale;
  publicUrl: string;
  /** Sujet et introduction réécrits par l'administration, s'il y en a */
  override?: EmailOverride;
  /**
   * Lien « ce n'était pas moi », à usage unique. Absent quand le serveur n'a pas
   * d'adresse publique configurée : il n'y aurait nulle part où pointer.
   */
  notMeUrl?: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/* ── Habillage ──────────────────────────────────────────────────────────── */

const ENCRE = '#1f2328';
const DISCRET = '#656d76';
const BORDURE = '#d8dee4';
const ACCENT = '#5754c7';
const FOND = '#f6f8fa';

/*
 * En-tête de marque.
 *
 * Le logo est un PNG servi par le serveur : le SVG est retiré par la plupart des
 * clients de messagerie, et une image en data: l'est aussi par Gmail. On utilise la
 * variante prévue pour fond sombre, posée sur un carré sombre — c'est son usage.
 *
 * Le nom reste du texte à côté de l'image, et non dans l'image : les clients
 * bloquent les images par défaut, et l'en-tête doit se lire quand même.
 * Sans adresse publique configurée, il n'y a pas d'URL valide : le carré se réduit
 * alors à l'initiale, toujours lisible.
 */
const marque = (publicUrl: string) => {
  const base = publicUrl.replace(/\/+$/, '');
  const pastille = base
    ? `<img src="${escapeHtml(base)}/brand/logo-on-dark.png" width="26" height="26" alt="BetterVault"
         style="display:block;width:26px;height:26px;border:0;">`
    : `<span style="font:700 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">B</span>`;
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="padding-right:10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="38" height="38"
          style="width:38px;height:38px;background-color:#161b22;border-radius:10px;">
          <tr><td align="center" valign="middle" style="width:38px;height:38px;text-align:center;">${pastille}</td></tr>
        </table>
      </td>
      <td class="bv-ink" style="font:600 17px/38px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ENCRE};">BetterVault</td>
    </tr>
  </table>`;
};

/** Bloc de code : gros, espacé, sélectionnable d'un geste */
const blocCode = (code: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0;">
    <tr>
      <td align="center" class="bv-code" style="padding:18px 12px;background-color:${FOND};border:1px solid ${BORDURE};border-radius:10px;
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
      <td class="bv-muted bv-line" style="padding:7px 12px 7px 0;border-bottom:1px solid ${BORDURE};font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${DISCRET};white-space:nowrap;">${escapeHtml(cle)}</td>
      <td class="bv-ink bv-line" style="padding:7px 0;border-bottom:1px solid ${BORDURE};font:500 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ENCRE};word-break:break-word;">${escapeHtml(valeur)}</td>
    </tr>`).join('')}
  </table>`;

const paragraphe = (texte: string) =>
  `<p class="bv-ink" style="margin:0 0 14px;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ENCRE};">${texte}</p>`;

/**
 * Ce qu'il faut faire si l'on n'est pas à l'origine de l'événement.
 *
 * Le conseil seul ne suffisait pas : lire « changez votre mot de passe » dans un
 * email suppose de savoir où aller, et d'y arriver avant celui qui vient d'entrer.
 * Le bouton ferme toutes les sessions en un clic, sans avoir à se connecter — c'est
 * le geste utile, et le seul que le lien autorise.
 */
const alerte = (texte: string, notMeUrl?: string, locale: Locale = 'en') => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0 4px;">
    <tr>
      <td class="bv-alert" style="padding:12px 14px;background-color:#fff8c5;border:1px solid #d4a72c;border-radius:8px;
        font:400 13.5px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#4d2d00;">
        ${texte}
        ${notMeUrl ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
          <tr>
            <td align="center" style="background-color:#cf222e;border-radius:8px;">
              <a href="${escapeHtml(notMeUrl)}" style="display:inline-block;padding:10px 18px;color:#ffffff;text-decoration:none;
                font:600 14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${t(locale, 'Ce n’était pas moi', 'This wasn’t me')}</a>
            </td>
          </tr>
        </table>
        <div class="bv-alert-note" style="margin-top:7px;font-size:12px;color:#6b4a00;">${t(locale, 'Déconnecte tous les appareils du compte. Utilisable une seule fois.', 'Signs every device out of your account. Works once.')}</div>` : ''}
      </td>
    </tr>
  </table>`;

function page(titre: string, corps: string, publicUrl: string, locale: Locale = 'en'): string {
  const lien = publicUrl
    ? `<a class="bv-link" href="${escapeHtml(publicUrl)}" style="color:${ACCENT};text-decoration:none;">${escapeHtml(publicUrl)}</a><br>`
    : '';
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(titre)}</title>
<style>
  /* Thème sombre, pour les clients qui le demandent (Apple Mail, Outlook,
     Gmail sur mobile…). Les styles en ligne restent la version claire : un
     client qui retire cette balise affiche un email clair et lisible. */
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .bv-bg { background-color: #0d1117 !important; }
    .bv-card { background-color: #161b22 !important; border-color: #30363d !important; }
    .bv-ink { color: #e6edf3 !important; }
    .bv-muted { color: #8b949e !important; }
    .bv-line { border-color: #30363d !important; }
    .bv-code { background-color: #0d1117 !important; border-color: #30363d !important; color: #e6edf3 !important; }
    .bv-alert { background-color: #2b2111 !important; border-color: #9e6a03 !important; color: #f0d58a !important; }
    .bv-alert-note { color: #d4b35c !important; }
    a.bv-link { color: #a5a2f5 !important; }
  }
  [data-ogsc] .bv-ink { color: #e6edf3 !important; }
  [data-ogsc] .bv-muted { color: #8b949e !important; }
  [data-ogsb] .bv-bg { background-color: #0d1117 !important; }
  [data-ogsb] .bv-card, [data-ogsb] .bv-code { background-color: #161b22 !important; }
</style>
</head>
<body class="bv-bg" style="margin:0;padding:0;background-color:${FOND};">
  <!-- Repris comme aperçu dans la liste des messages, jamais affiché dans le corps -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(titre)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="bv-bg" style="background-color:${FOND};">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="bv-card" style="max-width:520px;background-color:#ffffff;border:1px solid ${BORDURE};border-radius:14px;">
          <tr>
            <td style="padding:22px 26px 0;">${marque(publicUrl)}</td>
          </tr>
          <tr>
            <td style="padding:18px 26px 24px;">
              <h1 class="bv-ink" style="margin:0 0 14px;font:600 20px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ENCRE};">${escapeHtml(titre)}</h1>
              ${corps}
            </td>
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;">
          <tr>
            <td class="bv-muted" style="padding:16px 26px 0;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${DISCRET};">
              ${lien}${t(locale, 'Vous recevez cet email parce qu’il concerne la sécurité de votre compte BetterVault.', 'You are receiving this email because it concerns the security of your BetterVault account.')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const piedTexte = (publicUrl: string, locale: Locale) =>
  `\n\n— BetterVault${publicUrl ? `\n${publicUrl}` : ''}\n${t(locale,
    'Vous recevez cet email parce qu’il concerne la sécurité de votre compte BetterVault.',
    'You are receiving this email because it concerns the security of your BetterVault account.')}`;

/**
 * Assemble le message. Une personnalisation ne remplace que le sujet et une
 * introduction : elle est posée comme du texte, échappée, au-dessus du corps
 * produit par le serveur. Les faits et l'avertissement restent en dessous.
 */
const message = (ctx: EmailContext, subject: string, texte: string, corpsHtml: string): MailMessage => {
  const locale = ctx.locale;
  const intro = (ctx.override?.intro ?? '').trim();
  const sujet = (ctx.override?.subject ?? '').trim() || subject;
  return {
    to: ctx.to,
    subject: sujet,
    // Le lien figure aussi en texte : c'est la version que certains clients affichent
    text: (intro ? `${intro}

` : '') + texte + (ctx.notMeUrl ? `

${t(locale, 'Ce n’était pas moi — déconnecter tous les appareils du compte :', 'This wasn’t me — sign every device out of the account:')}
${ctx.notMeUrl}
${t(locale, '(utilisable une seule fois)', '(works once)')}` : '') + piedTexte(ctx.publicUrl, locale),
    html: page(sujet, (intro ? paragraphe(escapeHtml(intro)) : '') + corpsHtml, ctx.publicUrl, locale)
  };
};

/* ── Messages ───────────────────────────────────────────────────────────── */

export const emails = {
  resetCode(ctx: EmailContext, code: string, minutes: number): MailMessage {
    const l = ctx.locale;
    return message(
      ctx,
      t(l, `Code de réinitialisation BetterVault : ${code}`, `BetterVault reset code: ${code}`),
      t(l,
        `Votre code : ${code}\n\nIl est valable ${minutes} minutes.\nSi vous n’avez pas demandé à réinitialiser votre mot de passe, ignorez cet email : rien ne change sans ce code.`,
        `Your code: ${code}\n\nIt is valid for ${minutes} minutes.\nIf you did not ask to reset your password, ignore this email: nothing changes without this code.`),
      paragraphe(t(l, 'Utilisez ce code pour continuer la réinitialisation de votre mot de passe principal.', 'Use this code to continue resetting your master password.'))
        + blocCode(code)
        + paragraphe(`<span class="bv-muted" style="color:${DISCRET};">${t(l, `Il expire dans ${minutes} minutes.`, `It expires in ${minutes} minutes.`)}</span>`)
        + alerte(
          t(l,
            'Si vous n’avez pas demandé cette réinitialisation, ignorez cet email — rien ne change sans ce code. Vous pouvez aussi l’annuler tout de suite.',
            'If you did not ask to reset your password, ignore this email — nothing changes without this code. You can also cancel it right away.'),
          ctx.notMeUrl, l)
    );
  },

  newLogin(ctx: EmailContext, when: number, address: string, device: string): MailMessage {
    const l = ctx.locale;
    const appareil = device || t(l, 'inconnu', 'unknown');
    return message(
      ctx,
      t(l, 'Nouvelle connexion à votre compte BetterVault', 'New sign-in to your BetterVault account'),
      t(l,
        `Une connexion a eu lieu le ${formatDate(when, l)}.\nAdresse IP : ${address}\nAppareil : ${appareil}\n\nSi ce n’était pas vous, changez votre mot de passe principal et activez la double authentification.`,
        `A sign-in happened on ${formatDate(when, l)}.\nIP address: ${address}\nDevice: ${appareil}\n\nIf this wasn't you, change your master password and turn on two-factor authentication.`),
      paragraphe(t(l, 'Quelqu’un s’est connecté à votre compte.', 'Someone signed in to your account.'))
        + faits([
          [t(l, 'Quand', 'When'), formatDate(when, l)],
          [t(l, 'Adresse IP', 'IP address'), address],
          [t(l, 'Appareil', 'Device'), appareil]
        ])
        + alerte(t(l, 'Si ce n’était pas vous, agissez maintenant.', 'If this wasn’t you, act now.'), ctx.notMeUrl, l)
    );
  },

  passwordChanged(ctx: EmailContext, when: number, viaRecovery: boolean): MailMessage {
    const l = ctx.locale;
    const comment = viaRecovery ? t(l, ' avec la clé de secours', ' using account recovery') : '';
    return message(
      ctx,
      t(l, 'Mot de passe principal changé', 'Master password changed'),
      t(l,
        `Le mot de passe principal de votre compte a été changé${comment} le ${formatDate(when, l)}.\nLes autres appareils devront se reconnecter.\n\nSi ce n’était pas vous, contactez l’administration du serveur.`,
        `Your account's master password was changed${comment} on ${formatDate(when, l)}.\nOther devices will need to sign in again.\n\nIf this wasn't you, contact the server administrator.`),
      paragraphe(t(l, `Le mot de passe principal de votre compte a été changé${comment}.`, `Your account’s master password was changed${comment}.`))
        + faits([[t(l, 'Quand', 'When'), formatDate(when, l)]])
        + paragraphe(`<span class="bv-muted" style="color:${DISCRET};">${t(l, 'Les autres appareils devront se reconnecter.', 'Other devices will need to sign in again.')}</span>`)
        + alerte(t(l, 'Si ce n’était pas vous, agissez maintenant.', 'If this wasn’t you, act now.'), ctx.notMeUrl, l)
    );
  },

  vaultReset(ctx: EmailContext, when: number): MailMessage {
    const l = ctx.locale;
    return message(
      ctx,
      t(l, 'Compte BetterVault réinitialisé', 'BetterVault account reset'),
      t(l,
        `Votre compte a été réinitialisé sans clé de secours le ${formatDate(when, l)}.\nLe coffre précédent a été remplacé par un coffre vide.`,
        `Your account was reset without a recovery key on ${formatDate(when, l)}.\nThe previous vault was replaced with an empty one.`),
      paragraphe(t(l, 'Votre compte a été réinitialisé sans clé de secours.', 'Your account was reset without a recovery key.'))
        + faits([[t(l, 'Quand', 'When'), formatDate(when, l)]])
        + paragraphe(t(l,
          'Le coffre précédent a été remplacé par un coffre vide. Son contenu est irrécupérable.',
          'The previous vault was replaced with an empty one. Its contents cannot be recovered.'))
        + alerte(t(l,
          'Si ce n’était pas vous, agissez maintenant — puis contactez l’administration de votre serveur.',
          'If this wasn’t you, act now — then contact the administrator of your server.'), ctx.notMeUrl, l)
    );
  },

  twoFactor(ctx: EmailContext, when: number, enabled: boolean): MailMessage {
    const l = ctx.locale;
    const etat = enabled ? t(l, 'activée', 'on') : t(l, 'désactivée', 'off');
    return message(
      ctx,
      t(l, `Double authentification ${etat}`, `Two-factor authentication turned ${etat}`),
      t(l,
        `La double authentification a été ${etat} sur votre compte le ${formatDate(when, l)}.`,
        `Two-factor authentication was turned ${etat} for your account on ${formatDate(when, l)}.`),
      paragraphe(t(l,
        `La double authentification a été <strong>${etat}</strong> sur votre compte.`,
        `Two-factor authentication was turned <strong>${etat}</strong> for your account.`))
        + faits([[t(l, 'Quand', 'When'), formatDate(when, l)]])
        + alerte(t(l,
          'Si ce n’était pas vous, agissez maintenant, puis changez votre mot de passe principal.',
          'If this wasn’t you, act now, then change your master password.'), ctx.notMeUrl, l)
    );
  },

  recoveryKeyChanged(ctx: EmailContext, when: number): MailMessage {
    const l = ctx.locale;
    return message(
      ctx,
      t(l, 'Nouvelle clé de secours', 'New recovery key'),
      t(l,
        `Une nouvelle clé de secours a été créée le ${formatDate(when, l)}. La précédente ne fonctionne plus.`,
        `A new recovery key was created on ${formatDate(when, l)}. The previous one no longer works.`),
      paragraphe(t(l, 'Une nouvelle clé de secours a été créée pour votre compte.', 'A new recovery key was created for your account.'))
        + faits([[t(l, 'Quand', 'When'), formatDate(when, l)]])
        + paragraphe(t(l,
          'La précédente ne fonctionne plus. Gardez la nouvelle hors de BetterVault.',
          'The previous key no longer works. Keep the new one outside BetterVault.'))
        + alerte(t(l,
          'Si ce n’était pas vous, agissez maintenant — puis contactez l’administration de votre serveur.',
          'If this wasn’t you, act now — then contact the administrator of your server.'), ctx.notMeUrl, l)
    );
  },

  sharedInvite(ctx: EmailContext, inviterEmail: string): MailMessage {
    const l = ctx.locale;
    return message(
      ctx,
      t(l, `${inviterEmail} vous invite à un coffre partagé`, `${inviterEmail} invited you to a shared vault`),
      t(l,
        `${inviterEmail} vous invite à un coffre partagé BetterVault.\nOuvrez BetterVault, puis Coffres partagés, pour accepter ou refuser.`,
        `${inviterEmail} invited you to a shared BetterVault vault.\nOpen BetterVault, then Shared vaults, to accept or decline.`),
      paragraphe(t(l,
        `<strong>${escapeHtml(inviterEmail)}</strong> vous invite à un coffre partagé BetterVault.`,
        `<strong>${escapeHtml(inviterEmail)}</strong> invited you to a shared BetterVault vault.`))
        + paragraphe(`<span class="bv-muted" style="color:${DISCRET};">${t(l,
          'Ouvrez BetterVault, puis <strong>Coffres partagés</strong>, pour accepter ou refuser. Rien n’est partagé tant que vous n’avez pas accepté.',
          'Open BetterVault, then <strong>Shared vaults</strong>, to accept or decline. Nothing is shared until you accept.')}</span>`)
    );
  },

  test(to: string, locale: Locale, override?: EmailOverride): MailMessage {
    return message(
      { to, locale, publicUrl: '', override },
      t(locale, 'Email de test BetterVault', 'BetterVault test email'),
      t(locale, 'Les réglages SMTP de votre serveur BetterVault fonctionnent.', 'The SMTP settings of your BetterVault server work.'),
      paragraphe(t(locale,
        'Les réglages SMTP de votre serveur BetterVault fonctionnent. Rien d’autre à faire.',
        'The SMTP settings of your BetterVault server work. Nothing else to do.'))
    );
  }
};
