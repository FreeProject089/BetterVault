/**
 * Page d'accueil publique du serveur et annuaire de serveurs.
 *
 * L'hébergeur présente son serveur (/about) et peut recommander d'autres serveurs
 * BetterVault — les siens dans d'autres régions, ou ceux de confiance. L'application
 * propose cette liste au moment de choisir un serveur. Les deux se désactivent, et
 * rien n'y figure que l'hébergeur n'ait saisi lui-même.
 */

import { ART_CSS, artAccount, artCipher, artDevices, artUnlock, heroArt, icon, snakeSteps, tile, type IconName } from './landingArt.ts';
import { CHROME_CSS, siteFooter, siteHeader, type ChromeContext } from './siteChrome.ts';

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

/** Styles communs aux pages publiques : couleurs, typographie, boutons */
function baseCss(): string {
  return `
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#7773e8;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f8fa;--card:#fff;--border:#d0d7de;--text:#1f2328;--muted:#59636e;--accent:#5754c7;color-scheme:light}}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:80px}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow-x:hidden}
a{color:var(--accent)}
main{max-width:1120px;margin:0 auto;padding:0 20px 88px}
section{padding:80px 0 0}
h1{font-size:clamp(34px,5.4vw,56px);line-height:1.06;letter-spacing:-0.03em;margin:0 0 18px}
h1 em{font-style:normal;background:linear-gradient(100deg,var(--accent),#6cb6f5);-webkit-background-clip:text;background-clip:text;color:transparent}
.lede{font-size:clamp(17px,2.1vw,19px);color:var(--muted);max-width:56ch;margin:0 0 12px}
.eyebrow{display:inline-block;font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:0 0 10px}
h2{font-size:clamp(26px,3.4vw,38px);letter-spacing:-0.02em;line-height:1.15;margin:0 0 10px}
.section-lede{color:var(--muted);margin:0;max-width:62ch;font-size:17px}
h3{font-size:16px;margin:0 0 6px}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin:30px 0 0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:0 24px;border-radius:14px;border:1px solid var(--border);
  color:var(--text);text-decoration:none;font-weight:650;font-size:15.5px;background:var(--card);transition:transform .15s,border-color .15s,filter .15s,box-shadow .15s}
.btn:hover{border-color:var(--accent);transform:translateY(-1px)}
.btn .arrow{transition:transform .15s}.btn:hover .arrow{transform:translateX(3px)}
.btn.primary{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 88%,#fff),var(--accent));border-color:transparent;color:#fff;
  box-shadow:0 16px 34px -16px var(--accent),inset 0 1px 0 rgba(255,255,255,.25)}
.btn.primary:hover{filter:brightness(1.06);box-shadow:0 20px 40px -16px var(--accent),inset 0 1px 0 rgba(255,255,255,.25)}
.btn.small{min-height:40px;padding:0 14px;font-size:14px;border-radius:10px}
.note{color:var(--muted);font-size:14px;margin:16px 0 0}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;padding:0;margin:24px 0 0;list-style:none}
.facts li{display:flex;gap:14px;align-items:flex-start;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px}
.facts strong{display:block}.meta{color:var(--muted);font-size:14px}
.cta{margin-top:80px;padding:40px;border-radius:24px;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));
  background:radial-gradient(500px 220px at 90% 10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent),var(--card);display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between}
.cta h2{margin:0;font-size:clamp(22px,2.8vw,30px)}.cta p{margin:6px 0 0;color:var(--muted)}
.badge{display:inline-flex;align-items:center;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);color:var(--accent)}
@media (max-width:640px){section{padding:56px 0 0}.actions .btn{flex:1 1 100%}.cta{padding:26px}}
`;
}

const chrome = (ctx: LandingContext): ChromeContext => ({
  locale: ctx.locale,
  appAvailable: ctx.appAvailable,
  serversOn: ctx.page.directoryEnabled && ctx.page.servers.length > 0,
  legalEnabled: ctx.legalEnabled,
  version: ctx.version,
  operatorName: ctx.operatorName
});

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
<style>${baseCss()}${CHROME_CSS}${ART_CSS}</style>
</head>
<body>
${body}
${siteFooter(chrome(ctx))}
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
  const heading = ctx.page.title
    ? escapeHtml(ctx.page.title)
    : t('Vos secrets, <em>chiffrés chez vous</em>.', 'Your secrets, <em>encrypted at home</em>.');

  const features = FEATURES.map(([ic, tf, te, df, de]) => `
    <li>${tile(ic, 'md')}<h3>${t(tf, te)}</h3><p>${t(df, de)}</p></li>`).join('');

  const serversOn = ctx.page.directoryEnabled && ctx.page.servers.length > 0;
  const start = ctx.appAvailable ? '/app' : '/docs/guide/premiers-pas';

  const steps = snakeSteps([
    {
      title: t('Créez votre compte', 'Create your account'),
      subtitle: t('Un email, un mot de passe principal. C’est tout.', 'An email and a master password. That’s it.'),
      text: t('Votre mot de passe ne quitte jamais l’appareil : il sert à fabriquer la clé du coffre, avec Argon2id. Notez la clé de secours affichée à la fin.', 'Your password never leaves the device: it derives the vault key with Argon2id. Write down the recovery key shown at the end.'),
      art: artAccount({ email: 'Email', password: t('Mot de passe principal', 'Master password'), strong: t('Solide', 'Strong'), button: t('Créer mon coffre', 'Create my vault'), chip: t('Clé créée sur l’appareil', 'Key made on device') })
    },
    {
      title: t('Ajoutez vos accès', 'Add your logins'),
      subtitle: t('Tout est chiffré avant de partir.', 'Everything is encrypted before it leaves.'),
      text: t('Importez depuis Bitwarden, 1Password, Chrome ou un fichier. Le serveur ne reçoit qu’un bloc illisible — essayez la bascule pour voir ce qu’il voit.', 'Import from Bitwarden, 1Password, Chrome or a file. The server only receives an unreadable blob — try the toggle to see what it sees.'),
      art: artCipher({ you: t('Ce que vous voyez', 'What you see'), server: t('Ce que voit le serveur', 'What the server sees'), rows: [['GitHub', 'marie.dupont'], ['Banque', 'n° 04 22 81'], ['Netflix', 'marie@exemple.fr']] })
    },
    {
      title: t('Retrouvez-les partout', 'Find them everywhere'),
      subtitle: t('Bureau, téléphone, navigateur.', 'Desktop, phone, browser.'),
      text: t('Chaque appareil reçoit le coffre chiffré et le déchiffre pour lui. Deux modifications faites en même temps sont fusionnées, rien ne se perd.', 'Each device receives the encrypted vault and decrypts it for itself. Two edits made at the same time are merged, nothing is lost.'),
      art: artDevices({ synced: t('Synchronisé', 'Synced') })
    },
    {
      title: t('Vous seul l’ouvrez', 'Only you can open it'),
      subtitle: t('Empreinte, visage ou clé de sécurité.', 'Fingerprint, face or security key.'),
      text: t('Déverrouillez d’un geste, remplissez les formulaires de connexion et vos codes 2FA. Même l’hébergeur de ce serveur ne peut pas lire votre coffre.', 'Unlock in one gesture, fill sign-in forms and your 2FA codes. Even the operator of this server cannot read your vault.'),
      art: artUnlock({ code: t('Code 2FA · GitHub', '2FA code · GitHub'), unlocked: t('Déverrouillé', 'Unlocked') })
    }
  ], t('Étape', 'Step'));

  const faq: Array<[string, string, string, string]> = [
    ['Que se passe-t-il si j’oublie mon mot de passe principal ?', 'What if I forget my master password?',
     'La clé de secours, donnée à la création du compte, permet d’en choisir un nouveau. Sans elle, personne — pas même l’hébergeur — ne peut rouvrir le coffre : c’est le prix d’un chiffrement réel.',
     'The recovery key, given when you create the account, lets you choose a new one. Without it nobody — not even the operator — can reopen the vault: that is the price of real encryption.'],
    ['Le serveur peut-il lire mes données ?', 'Can the server read my data?',
     'Non. Il stocke des blocs chiffrés en AES-256-GCM avec une clé qu’il n’a jamais reçue. Une fuite de la base ne révèle aucun mot de passe.',
     'No. It stores blocks encrypted with AES-256-GCM using a key it never received. A database leak reveals no password.'],
    ['Puis-je partir avec mes données ?', 'Can I leave with my data?',
     'Oui : export complet chiffré, fichiers compris, ou formats Bitwarden, 1Password, KeePass, CSV. Le même export s’importe sur un autre serveur.',
     'Yes: full encrypted export, files included, or Bitwarden, 1Password, KeePass, CSV formats. The same export imports onto another server.'],
    ['Puis-je héberger mon propre serveur ?', 'Can I host my own server?',
     'Oui, avec Docker en quelques minutes. La documentation couvre l’installation, les sauvegardes S3, la grappe de serveurs et les documents légaux.',
     'Yes, with Docker in a few minutes. The documentation covers installation, S3 backups, server clusters and legal documents.']
  ];

  const body = `${siteHeader(chrome(ctx), 'home')}
<main id="contenu">
  <section class="hero">
    <div>
      <h1>${heading}</h1>
      ${ctx.page.title ? `<p class="meta">${escapeHtml(title)}</p>` : ''}
      ${intro}
      <div class="actions">
        <a class="btn primary" href="${start}">${icon('safe', 20)}${t('Premiers pas', 'Get started')}<span class="arrow" aria-hidden="true">→</span></a>
        <a class="btn" href="/docs">${icon('files', 20)}${t('Documentation', 'Documentation')}</a>
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

  <section id="fonctions">
    <p class="eyebrow">${t('Fonctionnalités', 'Features')}</p>
    <h2>${t('Tout ce qu’il faut, rien de lisible par le serveur', 'Everything you need, nothing the server can read')}</h2>
    <p class="section-lede">${t('Un seul coffre pour vos accès, vos codes et vos documents, sur tous vos appareils.', 'One vault for your logins, codes and documents, on all your devices.')}</p>
    <ul class="features">${features}</ul>
  </section>

  <section id="comment">
    <p class="eyebrow">${t('Comment ça marche', 'How it works')}</p>
    <h2>${t('Quatre étapes, aucune clé confiée', 'Four steps, no key handed over')}</h2>
    <p class="section-lede">${t('De la création du compte au déverrouillage, votre clé reste sur vos appareils.', 'From creating the account to unlocking, your key stays on your devices.')}</p>
    ${steps}
  </section>

  <div class="band">
    <div class="band-in">
      <span class="safe">${icon('safe', 80)}</span>
      <div>
        <h2>${t('Chiffrement de bout en bout, sans exception', 'End-to-end encryption, no exceptions')}</h2>
        <p>${t('Mots de passe, codes 2FA, notes, tâches, pièces jointes et coffres partagés : tout est chiffré sur l’appareil. Le code est ouvert, vous pouvez le vérifier.', 'Passwords, 2FA codes, notes, tasks, attachments and shared vaults: everything is encrypted on the device. The code is open, you can check it.')}</p>
        <a class="btn" href="${start}">${t('Premiers pas', 'Get started')}<span class="arrow" aria-hidden="true">→</span></a>
      </div>
    </div>
  </div>

  <section id="questions">
    <p class="eyebrow">${t('Questions', 'Questions')}</p>
    <h2>${t('Questions fréquentes', 'Frequently asked questions')}</h2>
    <div class="faq">${faq.map(([qf, qe, af, ae], i) => `
      <details${i === 0 ? ' open' : ''}><summary>${t(qf, qe)}</summary><p>${t(af, ae)}</p></details>`).join('')}
    </div>
  </section>

  <section>
    <p class="eyebrow">${t('Ce serveur', 'This server')}</p>
    <h2>${escapeHtml(ctx.operatorName || t('Hébergeur indépendant', 'Independent operator'))}</h2>
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
      : `<a class="btn primary" href="${start}">${t('Premiers pas', 'Get started')}<span class="arrow" aria-hidden="true">→</span></a>`}
  </div>
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
  const body = `${siteHeader(chrome(ctx), 'servers')}
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
