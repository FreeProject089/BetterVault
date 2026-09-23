/**
 * Page d'accueil publique du serveur et annuaire de serveurs.
 *
 * L'hébergeur présente son serveur (/about) et peut recommander d'autres serveurs
 * BetterVault — les siens dans d'autres régions, ou ceux de confiance. L'application
 * propose cette liste au moment de choisir un serveur. Les deux se désactivent, et
 * rien n'y figure que l'hébergeur n'ait saisi lui-même.
 */

import { ART_CSS, heroArt, icon, stepsArt, tile, type IconName } from './landingArt.ts';

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
  /** Thème de l'administration quand l'appareil n'en a pas choisi */
  adminTheme: AdminTheme;
}

export type AdminTheme = 'app' | 'auto' | 'light' | 'dark';
const ADMIN_THEMES: AdminTheme[] = ['app', 'auto', 'light', 'dark'];

export const DEFAULT_PUBLIC_PAGE: PublicPageSettings = {
  landingEnabled: true,
  title: '',
  description: '',
  directoryEnabled: false,
  servers: [],
  adminTheme: 'app'
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
    servers,
    adminTheme: ADMIN_THEMES.includes(p.adminTheme as AdminTheme) ? p.adminTheme as AdminTheme : current.adminTheme ?? 'app'
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
const FEATURES: Array<[IconName, string, string, string, string]> = [
  ['password', 'Mots de passe et codes 2FA', 'Passwords and 2FA codes',
   'Un coffre pour vos identifiants, vos codes à usage unique et vos passkeys, avec recherche, étiquettes et audit de sécurité.',
   'One vault for your logins, one-time codes and passkeys, with search, tags and a security audit.'],
  ['lockKey', 'Chiffré sur votre appareil', 'Encrypted on your device',
   'Argon2id pour la clé, AES-256-GCM pour le contenu. Le serveur ne reçoit que des octets illisibles : il ne peut pas lire vos données.',
   'Argon2id for the key, AES-256-GCM for the content. The server only ever receives unreadable bytes: it cannot read your data.'],
  ['devices', 'Partout, du même coffre', 'Everywhere, from one vault',
   'Site web, application de bureau, téléphone et extension de navigateur, avec remplissage des formulaires de connexion.',
   'Website, desktop app, phone and browser extension, with sign-in form filling.'],
  ['sync', 'Synchronisation sans conflit perdu', 'Sync that loses nothing',
   'Historique des versions, fusion des modifications faites en même temps sur deux appareils, corbeille de 30 jours.',
   'Version history, merging of changes made on two devices at once, and a 30-day trash.'],
  ['files', 'Fichiers et documents', 'Files and documents',
   'Pièces jointes chiffrées, recto et verso d’une pièce d’identité, envoi par morceaux qui reprend après une coupure.',
   'Encrypted attachments, front and back of an ID document, and chunked upload that resumes after a drop.'],
  ['users', 'Partage maîtrisé', 'Sharing you control',
   'Coffres partagés avec rôles et permissions, tâches attribuées, invitations vérifiées, retrait immédiat d’un membre.',
   'Shared vaults with roles and permissions, assigned tasks, verified invitations, immediate removal of a member.'],
  ['fingerprint', 'Deuxième facteur au choix', 'Second factor, your choice',
   'Clé de sécurité, empreinte ou visage de l’appareil, ou code d’une application d’authentification, plus une clé de secours.',
   'Security key, the device’s fingerprint or face, or an authenticator app code, plus a recovery key.'],
  ['export', 'Vos données restent les vôtres', 'Your data stays yours',
   'Export complet du compte, fichiers compris, import sur un autre serveur, et suppression définitive quand vous le décidez.',
   'Full account export, files included, import onto another server, and permanent deletion whenever you decide.']
];

/** Styles communs aux pages publiques : couleurs, typographie, en-tête, pied */
function baseCss(): string {
  return `
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#7773e8;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f8fa;--card:#fff;--border:#d0d7de;--text:#1f2328;--muted:#59636e;--accent:#5754c7;color-scheme:light}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.skip{position:absolute;left:-9999px}.skip:focus{left:12px;top:12px;z-index:9;background:var(--card);padding:8px 12px;border-radius:8px}
header{position:sticky;top:0;z-index:5;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--card) 88%,transparent);backdrop-filter:blur(10px)}
.bar{max-width:1120px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:6px}
.brand{display:inline-flex;align-items:center;gap:10px;margin-right:auto;color:var(--text);text-decoration:none;font-weight:700;font-size:15px}
.brand picture{display:flex}.brand img{width:28px;height:28px}
.bar nav{display:flex;align-items:center;gap:4px}
.bar nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border-radius:10px;color:var(--muted);text-decoration:none;font-size:14px;font-weight:500}
.bar nav a:hover,.bar nav a[aria-current]{color:var(--text);background:color-mix(in srgb,var(--muted) 12%,transparent)}
main{max-width:1120px;margin:0 auto;padding:0 20px 72px}
section{padding:64px 0 0}
h1{font-size:clamp(32px,5.2vw,52px);line-height:1.08;letter-spacing:-0.025em;margin:0 0 18px}
h1 em{font-style:normal;color:var(--accent)}
.lede{font-size:clamp(17px,2.1vw,19px);color:var(--muted);max-width:56ch;margin:0 0 12px}
h2{font-size:clamp(22px,3vw,28px);letter-spacing:-0.015em;margin:0 0 8px}
.section-lede{color:var(--muted);margin:0;max-width:62ch}
h3{font-size:16px;margin:0 0 6px}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0 0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border-radius:12px;border:1px solid var(--border);color:var(--text);text-decoration:none;font-weight:600;background:var(--card)}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 12px 30px -14px var(--accent)}
.btn.primary:hover{filter:brightness(1.08)}
.btn.small{min-height:40px;padding:0 14px;font-size:14px}
.note{color:var(--muted);font-size:14px;margin:16px 0 0}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;padding:0;margin:24px 0 0;list-style:none}
.facts li{display:flex;gap:14px;align-items:flex-start;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px}
.facts strong{display:block}.meta{color:var(--muted);font-size:14px}
.cta{margin-top:64px;padding:36px;border-radius:20px;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));
  background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 16%,var(--card)),var(--card));display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between}
.cta h2{margin:0}.cta p{margin:6px 0 0;color:var(--muted)}
footer{border-top:1px solid var(--border);margin-top:64px;padding:24px 0 0;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:14px}
footer a{display:inline-flex;align-items:center;min-height:44px;padding:0 4px;color:var(--muted);text-decoration:none}
footer a:hover{color:var(--text);text-decoration:underline}
footer .meta{margin-right:auto}
.badge{display:inline-flex;align-items:center;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);color:var(--accent)}
@media (max-width:640px){section{padding:44px 0 0}.btn{flex:1 1 100%}.bar nav a.hide-sm{display:none}.cta{padding:24px}}
`;
}

/** En-tête commun : marque, navigation, accès à l'application */
function header(ctx: LandingContext, current: 'home' | 'servers'): string {
  const t = (a: string, b: string) => (ctx.locale === 'fr' ? a : b);
  const serversOn = ctx.page.directoryEnabled && ctx.page.servers.length > 0;
  return `<a class="skip" href="#contenu">${t('Aller au contenu', 'Skip to content')}</a>
<header><div class="bar">
  <a class="brand" href="/"><picture><source srcset="/admin/logo-on-light.svg" media="(prefers-color-scheme: light)"><img src="/admin/logo-on-dark.svg" alt="" width="28" height="28"></picture>BetterVault</a>
  <nav aria-label="${t('Navigation principale', 'Main navigation')}">
    ${serversOn ? `<a class="hide-sm" href="/serveurs"${current === 'servers' ? ' aria-current="page"' : ''}>${t('Serveurs', 'Servers')}</a>` : ''}
    <a class="hide-sm" href="/docs">${t('Documentation', 'Documentation')}</a>
    ${ctx.appAvailable ? `<a class="btn primary small" href="/app">${t('Ouvrir l’application', 'Open the app')}</a>` : ''}
  </nav>
</div></header>`;
}

function footer(ctx: LandingContext): string {
  const t = (a: string, b: string) => (ctx.locale === 'fr' ? a : b);
  return `<footer>
    <span class="meta">BetterVault ${escapeHtml(ctx.version)}${ctx.operatorName ? ` · ${escapeHtml(ctx.operatorName)}` : ''}</span>
    ${ctx.page.directoryEnabled && ctx.page.servers.length ? `<a href="/serveurs">${t('Serveurs', 'Servers')}</a>` : ''}
    <a href="/docs">${t('Documentation', 'Documentation')}</a>
    ${ctx.legalEnabled ? `<a href="/legal">${t('Confidentialité et conditions', 'Privacy and terms')}</a>` : ''}
    <a href="/admin">${t('Administration', 'Administration')}</a>
  </footer>`;
}

function page(ctx: LandingContext, title: string, description: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="${ctx.locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" type="image/svg+xml" href="/admin/logo-on-dark.svg" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/admin/logo-on-light.svg" media="(prefers-color-scheme: light)">
<style>${baseCss()}${ART_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function renderLanding(ctx: LandingContext): string {
  const fr = ctx.locale === 'fr';
  const t = (a: string, b: string) => (fr ? a : b);
  const title = ctx.page.title || ctx.operatorName || 'BetterVault';
  const intro = ctx.page.description
    ? ctx.page.description.split(/\n{2,}/).map(p => `<p class="lede">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : `<p class="lede">${t(
        'Vos mots de passe, vos codes 2FA et vos fichiers, chiffrés sur votre appareil avant d’arriver ici. Ce serveur garde le coffre, sans jamais pouvoir l’ouvrir.',
        'Your passwords, 2FA codes and files, encrypted on your device before they get here. This server keeps the vault without ever being able to open it.')}</p>`;
  // Titre par défaut : une promesse, avec le mot qui compte mis en avant
  const heading = ctx.page.title
    ? escapeHtml(ctx.page.title)
    : t('Vos secrets, <em>chiffrés chez vous</em>.', 'Your secrets, <em>encrypted at home</em>.');

  const features = FEATURES.map(([ic, tf, te, df, de]) => `
    <li>${tile(ic, 'md')}<h3>${t(tf, te)}</h3><p>${t(df, de)}</p></li>`).join('');

  const serversOn = ctx.page.directoryEnabled && ctx.page.servers.length > 0;

  const body = `${header(ctx, 'home')}
<main id="contenu">
  <section class="hero">
    <div>
      <h1>${heading}</h1>
      ${ctx.page.title ? `<p class="meta">${escapeHtml(title)}</p>` : ''}
      ${intro}
      <div class="actions">
        ${ctx.appAvailable
          ? `<a class="btn primary" href="/app">${icon('vault', 20)}${ctx.registrationOpen ? t('Créer un coffre', 'Create a vault') : t('Ouvrir l’application', 'Open the app')}</a>`
          : `<a class="btn primary" href="/docs/guide/premiers-pas">${t('Premiers pas', 'Getting started')}</a>`}
        <a class="btn" href="/docs">${t('Lire la documentation', 'Read the documentation')}</a>
      </div>
      <ul class="trust">
        <li>${icon('lockKey', 18)}${t('Chiffré sur l’appareil', 'Encrypted on device')}</li>
        <li>${icon('shield', 18)}${t('Le serveur ne lit rien', 'The server reads nothing')}</li>
        <li>${icon('server', 18)}${t('Auto-hébergeable', 'Self-hostable')}</li>
      </ul>
      <p class="note">${ctx.registrationOpen
        ? t('Inscriptions ouvertes sur ce serveur. Aucune carte bancaire pour commencer.', 'Sign-ups are open on this server. No card needed to start.')
        : t('Ce serveur est sur invitation : demandez un accès à son hébergeur.', 'This server is invitation only: ask its operator for access.')}</p>
    </div>
    ${heroArt({ code: t('Code 2FA', '2FA code'), unlocked: t('Déverrouillé par empreinte', 'Unlocked by fingerprint'), synced: t('Synchronisé', 'Synced') })}
  </section>

  <section>
    <h2>${t('Tout ce qu’il faut, rien de lisible par le serveur', 'Everything you need, nothing the server can read')}</h2>
    <p class="section-lede">${t('Un seul coffre pour vos accès, vos codes et vos documents, sur tous vos appareils.', 'One vault for your logins, codes and documents, on all your devices.')}</p>
    <ul class="features">${features}</ul>
  </section>

  <section>
    <h2>${t('Comment ça marche', 'How it works')}</h2>
    ${stepsArt([
      { icon: 'devices', title: t('Votre mot de passe reste chez vous', 'Your password stays with you'), text: t('Il ne quitte jamais l’appareil : il sert à fabriquer la clé du coffre.', 'It never leaves the device: it derives the vault key.') },
      { icon: 'lockKey', title: t('Le coffre part chiffré', 'The vault leaves encrypted'), text: t('Le serveur stocke un bloc illisible, daté, et rien d’autre.', 'The server stores an unreadable, timestamped blob and nothing else.') },
      { icon: 'server', title: t('Chaque appareil déchiffre pour lui', 'Each device decrypts for itself'), text: t('Perdre le serveur ne révèle rien ; un mot de passe oublié se répare avec la clé de secours.', 'Losing the server reveals nothing; a forgotten password is fixed with the recovery key.') }
    ])}
  </section>

  <section>
    <h2>${t('Ce serveur', 'This server')}</h2>
    <ul class="facts">
      <li>${tile('server', 'sm')}<span><strong>${escapeHtml(ctx.operatorName || t('Hébergeur indépendant', 'Independent operator'))}</strong><span class="meta">${t('Responsable de ce serveur', 'Responsible for this server')}</span></span></li>
      <li>${tile('key', 'sm')}<span><strong>${ctx.registrationOpen ? t('Inscriptions ouvertes', 'Sign-ups open') : t('Sur invitation', 'Invitation only')}</strong><span class="meta">${t('Adresse à saisir dans l’application', 'Address to enter in the app')}</span></span></li>
      <li>${tile('shield', 'sm')}<span><strong>BetterVault ${escapeHtml(ctx.version)}</strong><span class="meta">${t('Version en service', 'Version running')}</span></span></li>
    </ul>
  </section>

  <div class="cta">
    <div>
      <h2>${serversOn ? t('Un autre serveur vous conviendrait mieux ?', 'Would another server suit you better?') : t('Prêt à ouvrir votre coffre ?', 'Ready to open your vault?')}</h2>
      <p>${serversOn ? t('Chaque serveur a ses propres comptes. Comparez-les avant de créer le vôtre.', 'Each server has its own accounts. Compare them before creating yours.') : t('Quelques secondes pour créer un compte, rien à installer.', 'A few seconds to create an account, nothing to install.')}</p>
    </div>
    ${serversOn
      ? `<a class="btn" href="/serveurs">${icon('globe', 20)}${t('Voir les serveurs', 'See the servers')}</a>`
      : ctx.appAvailable ? `<a class="btn primary" href="/app">${t('Commencer', 'Get started')}</a>` : ''}
  </div>

  ${footer(ctx)}
</main>`;

  return page(ctx, title, t('Gestionnaire de mots de passe chiffré de bout en bout : mots de passe, codes 2FA, fichiers et tâches.', 'End-to-end encrypted password manager: passwords, 2FA codes, files and tasks.'), body);
}

/**
 * Page des serveurs recommandés par l'hébergeur. Chaque serveur a ses propres
 * comptes : la page le dit avant la liste, pour qu'on ne cherche pas son
 * compte sur un autre serveur. Rien n'y figure que l'hébergeur n'ait saisi.
 */
export function renderServersPage(ctx: LandingContext): string | null {
  if (!ctx.page.directoryEnabled || ctx.page.servers.length === 0) return null;
  const t = (a: string, b: string) => (ctx.locale === 'fr' ? a : b);
  // Regroupés par région, les officiels d'abord
  const regions = new Map<string, DirectoryEntry[]>();
  for (const s of [...ctx.page.servers].sort((a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name))) {
    const region = s.region || t('Autres', 'Other');
    regions.set(region, [...(regions.get(region) ?? []), s]);
  }
  const body = `${header(ctx, 'servers')}
<main id="contenu">
  <section>
    <h1>${t('Serveurs BetterVault', 'BetterVault servers')}</h1>
    <p class="lede">${t('Chaque serveur a ses propres comptes : un compte créé sur l’un n’existe pas sur l’autre. Choisissez-en un, puis saisissez son adresse dans l’application.', 'Each server has its own accounts: an account created on one does not exist on another. Pick one, then enter its address in the app.')}</p>
  </section>
  ${[...regions].map(([region, list]) => `
  <section class="server-region">
    <h2>${icon('mapPin', 22)} ${escapeHtml(region)}</h2>
    <ul class="servers">${list.map(s => `
      <li>
        ${tile(s.official ? 'shield' : 'server', 'md')}
        <span class="server-main">
          <strong>${escapeHtml(s.name)} ${s.official ? `<span class="badge">${t('officiel', 'official')}</span>` : ''}</strong>
          <code>${escapeHtml(s.url)}</code>
        </span>
        <a class="btn small" href="${escapeHtml(s.url)}" rel="noopener">${t('Visiter', 'Visit')}</a>
      </li>`).join('')}
    </ul>
  </section>`).join('')}
  ${footer(ctx)}
</main>
<style>
.server-region h2{display:flex;align-items:center;gap:10px}
.server-region h2 .ph{color:var(--accent)}
.servers{list-style:none;padding:0;margin:16px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.servers li{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px}
.server-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.server-main code{color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>`;
  return page(ctx, t('Serveurs BetterVault', 'BetterVault servers'), t('Serveurs BetterVault recommandés par cet hébergeur.', 'BetterVault servers recommended by this operator.'), body);
}
