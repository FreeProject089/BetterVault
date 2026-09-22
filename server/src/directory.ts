/**
 * Page d'accueil publique du serveur et annuaire de serveurs.
 *
 * L'hébergeur présente son serveur (/about) et peut recommander d'autres serveurs
 * BetterVault — les siens dans d'autres régions, ou ceux de confiance. L'application
 * propose cette liste au moment de choisir un serveur. Les deux se désactivent, et
 * rien n'y figure que l'hébergeur n'ait saisi lui-même.
 */

export interface DirectoryEntry {
  name: string;
  url: string;
  region: string;
  official: boolean;
}

export interface PublicPageSettings {
  landingEnabled: boolean;
  title: string;
  description: string;
  directoryEnabled: boolean;
  servers: DirectoryEntry[];
}

export const DEFAULT_PUBLIC_PAGE: PublicPageSettings = {
  landingEnabled: true,
  title: '',
  description: '',
  directoryEnabled: false,
  servers: []
};

const MAX_SERVERS = 30;
const clean = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Seules des adresses https (ou locales) sans identifiants ni chemin exotique sont acceptées */
export function parseServerUrl(value: unknown): string | null {
  let url: URL;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export function parsePublicPage(input: unknown, current: PublicPageSettings = DEFAULT_PUBLIC_PAGE): PublicPageSettings {
  if (!input || typeof input !== 'object') return current;
  const p = input as Partial<PublicPageSettings>;
  const servers = Array.isArray(p.servers)
    ? p.servers.slice(0, MAX_SERVERS).flatMap((raw): DirectoryEntry[] => {
        const s = raw as Partial<DirectoryEntry> | null;
        const url = parseServerUrl(s?.url);
        const name = clean(s?.name, 40);
        if (!s || !url || !name) return [];
        return [{ name, url, region: clean(s.region, 30), official: s.official === true }];
      })
    : current.servers;
  return {
    landingEnabled: typeof p.landingEnabled === 'boolean' ? p.landingEnabled : current.landingEnabled,
    title: p.title === undefined ? current.title : clean(p.title, 80),
    description: p.description === undefined ? current.description : String(p.description ?? '').replace(/\r/g, '').trim().slice(0, 2000),
    directoryEnabled: typeof p.directoryEnabled === 'boolean' ? p.directoryEnabled : current.directoryEnabled,
    servers
  };
}

/** Ce que l'application reçoit : rien quand l'annuaire est coupé */
export function publicDirectory(page: PublicPageSettings): { enabled: boolean; servers: DirectoryEntry[] } {
  return page.directoryEnabled ? { enabled: true, servers: page.servers } : { enabled: false, servers: [] };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface LandingContext {
  page: PublicPageSettings;
  operatorName: string;
  registrationOpen: boolean;
  legalEnabled: boolean;
  appAvailable: boolean;
  version: string;
  locale: 'fr' | 'en';
}

/** Ce que l'application sait faire : montré tel quel sur la page d'accueil */
const FEATURES: Array<[string, string, string, string]> = [
  ['Mots de passe et codes 2FA', 'Passwords and 2FA codes',
   'Un coffre pour vos identifiants, vos codes à usage unique et vos passkeys, avec recherche, étiquettes et audit de sécurité.',
   'One vault for your logins, one-time codes and passkeys, with search, tags and a security audit.'],
  ['Chiffré sur votre appareil', 'Encrypted on your device',
   'Argon2id pour la clé, AES-256-GCM pour le contenu. Le serveur ne reçoit que des octets illisibles : il ne peut pas lire vos données.',
   'Argon2id for the key, AES-256-GCM for the content. The server only ever receives unreadable bytes: it cannot read your data.'],
  ['Partout, du même coffre', 'Everywhere, from one vault',
   'Site web, application de bureau, téléphone et extension de navigateur, avec remplissage des formulaires de connexion.',
   'Website, desktop app, phone and browser extension, with sign-in form filling.'],
  ['Synchronisation sans conflit perdu', 'Sync that loses nothing',
   'Historique des versions, fusion des modifications faites en même temps sur deux appareils, corbeille de 30 jours.',
   'Version history, merging of changes made on two devices at once, and a 30-day trash.'],
  ['Fichiers et documents', 'Files and documents',
   'Pièces jointes chiffrées, recto et verso d’une pièce d’identité, envoi par morceaux qui reprend après une coupure.',
   'Encrypted attachments, front and back of an ID document, and chunked upload that resumes after a drop.'],
  ['Partage maîtrisé', 'Sharing you control',
   'Coffres partagés avec rôles et permissions, invitations vérifiées, et retrait immédiat d’un membre.',
   'Shared vaults with roles and permissions, verified invitations, and immediate removal of a member.'],
  ['Deuxième facteur au choix', 'Second factor, your choice',
   'Clé de sécurité matérielle (WebAuthn) ou code d’une application d’authentification, plus une clé de secours.',
   'Hardware security key (WebAuthn) or an authenticator app code, plus a recovery key.'],
  ['Vos données restent les vôtres', 'Your data stays yours',
   'Export complet du compte, fichiers compris, import sur un autre serveur, et suppression définitive quand vous le décidez.',
   'Full account export, files included, import onto another server, and permanent deletion whenever you decide.']
];

export function renderLanding(ctx: LandingContext): string {
  const fr = ctx.locale === 'fr';
  const t = (a: string, b: string) => (fr ? a : b);
  const title = ctx.page.title || ctx.operatorName || 'BetterVault';
  const intro = ctx.page.description
    ? ctx.page.description.split(/\n{2,}/).map(p => `<p class="lede">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : `<p class="lede">${t(
        'Vos mots de passe, vos codes 2FA et vos fichiers, chiffrés sur votre appareil avant d’arriver ici. Ce serveur garde le coffre, sans jamais pouvoir l’ouvrir.',
        'Your passwords, 2FA codes and files, encrypted on your device before they get here. This server keeps the vault without ever being able to open it.')}</p>`;

  const features = FEATURES.map(([tf, te, df, de]) => `
    <li><h3>${t(tf, te)}</h3><p>${t(df, de)}</p></li>`).join('');

  const servers = ctx.page.directoryEnabled && ctx.page.servers.length ? `
    <section>
      <h2>${t('Autres serveurs', 'Other servers')}</h2>
      <p class="meta">${t('Chaque serveur a ses propres comptes : un compte créé ici n’existe pas ailleurs.', 'Each server has its own accounts: an account created here does not exist elsewhere.')}</p>
      <ul class="servers">${ctx.page.servers.map(s => `
        <li><strong>${escapeHtml(s.name)}</strong>${s.official ? ` <span class="badge">${t('officiel', 'official')}</span>` : ''}
          <span class="meta">${escapeHtml([s.region, s.url].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="${ctx.locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(t('Gestionnaire de mots de passe chiffré de bout en bout : mots de passe, codes 2FA, fichiers et tâches.', 'End-to-end encrypted password manager: passwords, 2FA codes, files and tasks.'))}">
<style>
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#7773e8;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f8fa;--card:#fff;--border:#d0d7de;--text:#1f2328;--muted:#656d76;--accent:#5754c7;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
header{border-bottom:1px solid var(--border);background:var(--card)}
header div{max-width:1040px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:12px}
header img{width:28px;height:28px}header strong{margin-right:auto;font-size:15px}
main{max-width:1040px;margin:0 auto;padding:0 20px 72px}
section{padding:56px 0 0}
.hero{padding:64px 0 8px}
h1{font-size:clamp(30px,5vw,46px);line-height:1.1;letter-spacing:-0.02em;margin:0 0 16px;max-width:19ch}
.lede{font-size:clamp(17px,2.2vw,19px);color:var(--muted);max-width:62ch;margin:0 0 12px}
h2{font-size:22px;margin:0 0 8px}h3{font-size:16px;margin:0 0 6px}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0 8px}
.btn{display:inline-flex;align-items:center;min-height:46px;padding:0 20px;border-radius:12px;border:1px solid var(--border);color:var(--text);text-decoration:none;font-weight:600}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.note{color:var(--muted);font-size:14px}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(248px,1fr));gap:14px;padding:0;margin:20px 0 0;list-style:none}
.features li{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px}
.features p{margin:0;color:var(--muted);font-size:14.5px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;padding:0;margin:20px 0 0;list-style:none}
.facts li{border-left:3px solid var(--accent);padding:4px 0 4px 14px}
.facts strong{display:block}.meta{color:var(--muted);font-size:14px}
.servers{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:8px}
.servers li{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.servers .meta{display:block}
.badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--accent);color:var(--accent)}
.steps{counter-reset:step;list-style:none;padding:0;margin:20px 0 0;display:grid;gap:12px}
.steps li{counter-increment:step;padding-left:42px;position:relative;color:var(--muted)}
.steps li::before{content:counter(step);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:var(--card);border:1px solid var(--border);color:var(--text);display:grid;place-items:center;font-size:13px;font-weight:700}
.steps strong{color:var(--text)}
footer{border-top:1px solid var(--border);margin-top:64px;padding:24px 0 0;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;font-size:14px}
footer .meta{margin-right:auto}
@media (max-width:560px){.hero{padding:40px 0 0}section{padding:40px 0 0}.btn{width:100%;justify-content:center}}
</style>
</head>
<body>
<header><div>
  <img src="/admin/logo-on-dark.svg" alt="" width="28" height="28">
  <strong>BetterVault</strong>
  <a href="/docs">${t('Documentation', 'Documentation')}</a>
  ${ctx.appAvailable ? `<a href="/">${t('Application', 'App')}</a>` : ''}
</div></header>
<main>
  <section class="hero">
    <h1>${escapeHtml(title)}</h1>
    ${intro}
    <div class="actions">
      ${ctx.appAvailable
        ? `<a class="btn primary" href="/">${ctx.registrationOpen ? t('Créer un coffre', 'Create a vault') : t('Ouvrir l’application', 'Open the app')}</a>`
        : `<a class="btn primary" href="/docs/guide/premiers-pas">${t('Premiers pas', 'Getting started')}</a>`}
      <a class="btn" href="/docs">${t('Lire la documentation', 'Read the documentation')}</a>
    </div>
    <p class="note">${ctx.registrationOpen
      ? t('Inscriptions ouvertes sur ce serveur. Aucune carte bancaire pour commencer.', 'Sign-ups are open on this server. No card needed to start.')
      : t('Ce serveur est sur invitation : demandez un accès à son hébergeur.', 'This server is invitation only: ask its operator for access.')}</p>
  </section>

  <section>
    <h2>${t('Ce que vous y trouvez', 'What you get')}</h2>
    <ul class="features">${features}</ul>
  </section>

  <section>
    <h2>${t('Comment ça marche', 'How it works')}</h2>
    <ol class="steps">
      <li><strong>${t('Votre mot de passe principal reste chez vous.', 'Your master password stays with you.')}</strong> ${t('Il ne quitte jamais l’appareil : il sert à fabriquer la clé du coffre.', 'It never leaves the device: it derives the vault key.')}</li>
      <li><strong>${t('Le coffre est chiffré, puis envoyé.', 'The vault is encrypted, then sent.')}</strong> ${t('Le serveur stocke un bloc illisible, daté, et rien d’autre.', 'The server stores an unreadable, timestamped blob and nothing else.')}</li>
      <li><strong>${t('Chaque appareil déchiffre pour lui.', 'Each device decrypts for itself.')}</strong> ${t('Perdre le serveur ne révèle rien ; perdre le mot de passe se répare avec la clé de secours.', 'Losing the server reveals nothing; losing the password is fixed with the recovery key.')}</li>
    </ol>
  </section>

  <section>
    <h2>${t('Ce serveur', 'This server')}</h2>
    <ul class="facts">
      <li><strong>${escapeHtml(ctx.operatorName || t('Hébergeur indépendant', 'Independent operator'))}</strong><span class="meta">${t('Responsable de ce serveur', 'Responsible for this server')}</span></li>
      <li><strong>${ctx.registrationOpen ? t('Inscriptions ouvertes', 'Sign-ups open') : t('Sur invitation', 'Invitation only')}</strong><span class="meta">${t('Adresse à saisir dans l’application', 'Address to enter in the app')}</span></li>
      <li><strong>BetterVault ${escapeHtml(ctx.version)}</strong><span class="meta">${t('Version en service', 'Version running')}</span></li>
    </ul>
  </section>

  ${servers}

  <footer>
    <span class="meta">BetterVault ${escapeHtml(ctx.version)}</span>
    <a href="/docs">${t('Documentation', 'Documentation')}</a>
    ${ctx.legalEnabled ? `<a href="/legal">${t('Confidentialité et conditions', 'Privacy and terms')}</a>` : ''}
    <a href="/admin">${t('Administration', 'Administration')}</a>
  </footer>
</main>
</body>
</html>`;
}
