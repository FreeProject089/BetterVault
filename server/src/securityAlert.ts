/**
 * Page « ce n'était pas moi ».
 *
 * Chaque email de sécurité porte un lien à usage unique. Celui qui le suit n'a
 * qu'une action à sa disposition : fermer toutes les sessions du compte et annuler
 * une réinitialisation en cours. Rien d'autre — pas d'accès au coffre, pas de
 * changement de mot de passe. Au pire, quelqu'un qui intercepte le lien déconnecte
 * des appareils, ce qui est exactement ce que demande la personne qui clique.
 *
 * La page est servie par le serveur, sans session : c'est la réception de l'email
 * qui fait la preuve. Elle est donc écrite ici, en HTML autonome.
 */

export type AlertKind =
  | 'reset_requested'
  | 'new_login'
  | 'password_changed'
  | 'recovery_key_changed'
  | 'totp_enabled'
  | 'totp_disabled'
  | 'recovery';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/** Ce que l'email annonçait, redit sur la page pour que l'on sache sur quoi on agit */
const CAUSE: Record<AlertKind, string> = {
  new_login: 'A sign-in to your account',
  password_changed: 'A change of master password',
  recovery_key_changed: 'A new recovery key',
  totp_enabled: 'Two-factor authentication being turned on',
  totp_disabled: 'Two-factor authentication being turned off',
  recovery: 'An account recovery',
  reset_requested: 'A password reset request'
};

const causeOf = (kind: string) => CAUSE[kind as AlertKind] ?? 'An action on your account';

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)} · BetterVault</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#7773e8;--danger:#f85149;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f8fa;--card:#fff;--border:#d0d7de;--text:#1f2328;--muted:#656d76;--accent:#5754c7;--danger:#cf222e;color-scheme:light}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);
     font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:26px}
h1{margin:0 0 6px;font-size:20px;line-height:1.3}
p{margin:0 0 14px;color:var(--text)}
.muted{color:var(--muted);font-size:13.5px}
.brand{display:flex;align-items:center;gap:9px;margin-bottom:18px;font-weight:600}
.brand span{width:26px;height:26px;border-radius:8px;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:14px}
ul{margin:0 0 16px;padding-left:20px;color:var(--muted);font-size:13.5px}
li{margin:3px 0}
button{width:100%;padding:11px 16px;font:600 15px inherit;color:#fff;background:var(--danger);
       border:none;border-radius:9px;cursor:pointer}
button:hover{filter:brightness(1.1)}
.ok{padding:12px 14px;border:1px solid var(--accent);border-radius:9px;background:rgba(119,115,232,.1)}
</style>
</head>
<body>
<main>
  <div class="brand"><span>B</span>BetterVault</div>
  ${body}
</main>
</body>
</html>`;
}

/** Page de confirmation : on explique ce qui va se passer avant de le faire */
export function renderNotMePage(kind: string, token: string): string {
  return page('Was this you?', `
  <h1>Was this you?</h1>
  <p class="muted">${escapeHtml(causeOf(kind))} was reported to you by email.</p>
  <p>If it wasn’t you, sign every device out of this account now:</p>
  <ul>
    <li>all sessions are closed, on every device;</li>
    <li>any password reset in progress is cancelled;</li>
    <li>your vault and its contents are untouched.</li>
  </ul>
  <form method="POST" action="/security/not-me/${escapeHtml(token)}">
    <button type="submit">Sign out every device</button>
  </form>
  <p class="muted" style="margin-top:16px">Then sign in again with your master password, and change it if you suspect it is known.
  This link works once, and expires seven days after the email was sent.</p>`);
}

export function renderNotMeDone(): string {
  return page('Devices signed out', `
  <h1>Devices signed out</h1>
  <div class="ok">Every session of this account has been closed, and any reset in progress cancelled.</div>
  <p class="muted" style="margin-top:16px">Sign in again with your master password. If you think someone else knows it,
  change it right away — and turn on two-factor authentication, so that knowing the password is no longer enough.</p>`);
}

export function renderNotMeExpired(): string {
  return page('Link no longer valid', `
  <h1>Link no longer valid</h1>
  <p>This link has already been used, or it has expired.</p>
  <p class="muted">Open BetterVault, then <strong>Account › Sessions</strong> to close the devices yourself.
  If you no longer have access to the account, contact the administrator of your server.</p>`);
}
