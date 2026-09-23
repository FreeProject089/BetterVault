/**
 * Page d'accueil publique du serveur et annuaire de serveurs.
 *
 * L'hébergeur présente son serveur (/about) et peut recommander d'autres serveurs
 * BetterVault — les siens dans d'autres régions, ou ceux de confiance. L'application
 * propose cette liste au moment de choisir un serveur. Les deux se désactivent, et
 * rien n'y figure que l'hébergeur n'ait saisi lui-même.
 */

import { SITE_JS_TAG } from './siteScript.ts';
import { ART_CSS, artAccount, artCipher, artDevices, artUnlock, circled, faqList, heroArt, highlight, icon, snakeSteps, tile, underline, vaultFeatures, type IconName } from './landingArt.ts';
import { CHROME_CSS, DEFAULT_LINKS, ICONS, pageLangCode, siteFooter, siteHeader, translator, type ChromeContext, type PageLang, type SiteLinks } from './siteChrome.ts';

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
  /** Adresse https d'un fichier JSON de liens (Discord, page d'état…) ; vide pour aucun */
  linksUrl: string;
}

export type AdminTheme = 'app' | 'auto' | 'light' | 'dark';
const ADMIN_THEMES: AdminTheme[] = ['app', 'auto', 'light', 'dark'];

export const DEFAULT_PUBLIC_PAGE: PublicPageSettings = {
  landingEnabled: true,
  title: '',
  description: '',
  directoryEnabled: false,
  servers: [],
  adminTheme: 'app',
  linksUrl: ''
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
    linksUrl: p.linksUrl === undefined ? current.linksUrl ?? '' : (String(p.linksUrl ?? '').trim() === '' ? '' : (/^https:\/\/[^\s]+$/.test(String(p.linksUrl).trim()) ? String(p.linksUrl).trim().slice(0, 300) : current.linksUrl ?? '')),
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
  /** Liens communautaires (GitHub, Discord, page d'état…) */
  links?: SiteLinks;
  /** Chemin demandé, pour le lien de changement de langue */
  path?: string;
  /** Langue d'un pack de l'administration, ses traductions, et les langues proposées */
  lang?: string;
  strings?: Record<string, string>;
  langs?: PageLang[];
  /** Serveurs officiels de la grappe, quand il y en a plusieurs */
  officialServers?: Array<{ name: string; region: string; zone: string; online: boolean }>;
  /** Offres payantes publiées, pour la page des tarifs */
  plans?: PublicPlan[];
  /** Limites du compte gratuit, pour la page des tarifs */
  freeLimits?: { maxVaults: number; maxCredentialsPerVault: number; attachmentQuotaBytes: number };
}

/** Offre telle que la montre la page des tarifs */
export interface PublicPlan {
  id: string;
  name: string;
  description: string;
  prices: Array<{ label: string; amount?: number; currency?: string; interval?: 'month' | 'year' | 'once' }>;
  boosts: Partial<Record<string, number>>;
}

/** Ce que l'application sait faire : montré tel quel sur la page d'accueil */
const FEATURES: Array<[IconName, string, string, string, string]> = [
  ['password', 'Mots de passe et codes 2FA', 'Passwords and 2FA codes',
   'Identifiants, codes à usage unique et passkeys, avec recherche, étiquettes et audit des mots de passe faibles ou réutilisés.',
   'Logins, one-time codes and passkeys, with search, tags and an audit of weak or reused passwords.'],
  ['lockKey', 'Chiffré sur votre appareil', 'Encrypted on your device',
   'Argon2id pour la clé, AES-256-GCM pour le contenu. Le serveur ne reçoit que des octets illisibles.',
   'Argon2id for the key, AES-256-GCM for the content. The server only receives unreadable bytes.'],
  ['devices', 'Web, Windows, Linux, Android', 'Web, Windows, Linux, Android',
   'Le même coffre dans le navigateur, sur ordinateur et sur téléphone, avec le remplissage automatique sur Android.',
   'The same vault in the browser, on desktop and on phone, with autofill on Android.'],
  ['sync', 'Synchronisation sans perte', 'Sync that loses nothing',
   'Historique des versions, fusion des modifications faites en même temps, corbeille de 30 jours.',
   'Version history, merging of simultaneous edits, and a 30-day trash.'],
  ['files', 'Fichiers et documents', 'Files and documents',
   'Pièces jointes chiffrées, envoyées par morceaux : un envoi coupé reprend où il s’était arrêté.',
   'Encrypted attachments, uploaded in chunks: an interrupted upload resumes where it stopped.'],
  ['users', 'Coffres partagés', 'Shared vaults',
   'Rôles et permissions, tâches attribuées, invitations vérifiées, retrait immédiat d’un membre.',
   'Roles and permissions, assigned tasks, verified invitations, immediate removal of a member.'],
  ['fingerprint', 'Deuxième facteur au choix', 'Second factor, your choice',
   'Clé de sécurité, empreinte ou visage de l’appareil, ou application d’authentification, plus une clé de secours.',
   'Security key, the device’s fingerprint or face, or an authenticator app, plus a recovery key.'],
  ['export', 'Vos données restent les vôtres', 'Your data stays yours',
   'Export complet chiffré, fichiers compris, import sur un autre serveur, suppression définitive quand vous voulez.',
   'Full encrypted export, files included, import onto another server, permanent deletion whenever you want.']
];

/** Page de documentation de chaque fonction, dans le même ordre */
const FEATURE_DOCS = [
  '/docs/guide/identifiants', '/docs/securite', '/docs/applications/bureau-mobile', '/docs/guide/synchronisation',
  '/docs/guide/pieces-jointes', '/docs/guide/partage', '/docs/guide/securite-compte', '/docs/guide/import-export'
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
main{max-width:1120px;margin:0 auto;padding:0 20px 96px}
section{padding:88px 0 0}
h1{font-size:clamp(34px,5.4vw,58px);line-height:1.08;letter-spacing:-0.03em;margin:0 0 20px}
.lede{font-size:clamp(17px,2.1vw,19px);color:var(--muted);max-width:56ch;margin:0 0 12px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:0 0 12px}
.eyebrow::before{content:"";width:18px;height:2px;border-radius:2px;background:currentColor}
h2{font-size:clamp(28px,3.6vw,40px);letter-spacing:-0.02em;line-height:1.15;margin:0 0 12px}
.section-lede{color:var(--muted);margin:0;max-width:62ch;font-size:17px}
.center{text-align:center}.center .section-lede{margin:0 auto}
h3{font-size:16px;margin:0 0 6px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:30px 0 0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:50px;padding:0 18px;border-radius:8px;border:1px solid var(--border);
  color:var(--text);text-decoration:none;font-weight:650;font-size:15.5px;background:var(--card);transition:transform .15s,border-color .15s,filter .15s,box-shadow .15s}
.btn:hover{border-color:color-mix(in srgb,var(--accent) 70%,var(--border));transform:translateY(-1px)}
.btn:active{transform:translateY(1px)}
.btn .ph{flex:0 0 auto}
.btn.primary{padding-right:6px;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 88%,#fff),var(--accent));border-color:transparent;color:#fff;
  box-shadow:0 16px 34px -16px var(--accent),inset 0 1px 0 rgba(255,255,255,.25)}
.btn.primary:hover{filter:brightness(1.06);box-shadow:0 20px 40px -16px var(--accent),inset 0 1px 0 rgba(255,255,255,.25)}
.go{display:grid;place-items:center;width:38px;height:38px;border-radius:6px;background:rgba(255,255,255,.22);transition:transform .2s,background-color .2s}
.btn:hover .go{transform:translateX(3px);background:rgba(255,255,255,.3)}
.btn.small{min-height:40px;padding:0 14px;font-size:14px}
.note{color:var(--muted);font-size:14px;margin:16px 0 0}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;padding:0;margin:24px 0 0;list-style:none}
.facts li{display:flex;gap:14px;align-items:flex-start;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:18px}
.facts strong{display:block}.meta{color:var(--muted);font-size:14px}
.cta{margin-top:88px;padding:40px;border-radius:9px;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));
  background:radial-gradient(500px 220px at 90% 10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent),var(--card);display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between}
.cta h2{margin:0;font-size:clamp(22px,2.8vw,30px)}.cta p{margin:6px 0 0;color:var(--muted)}
.badge{display:inline-flex;align-items:center;font-size:11px;font-weight:650;padding:2px 8px;border-radius:6px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);color:var(--accent)}
@media (max-width:640px){section{padding:64px 0 0}.actions .btn{flex:1 1 100%}.cta{padding:26px}}
`;
}

const chrome = (ctx: LandingContext): ChromeContext => ({
  locale: ctx.locale,
  appAvailable: ctx.appAvailable,
  serversOn: ctx.page.directoryEnabled && ctx.page.servers.length > 0,
  legalEnabled: ctx.legalEnabled,
  version: ctx.version,
  operatorName: ctx.operatorName,
  plansOn: (ctx.plans?.length ?? 0) > 0,
  links: ctx.links,
  path: ctx.path,
  lang: ctx.lang,
  strings: ctx.strings,
  langs: ctx.langs
});

function page(ctx: LandingContext, title: string, description: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(pageLangCode(ctx))}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" type="image/svg+xml" href="/admin/logo-on-dark.svg" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/admin/logo-on-light.svg" media="(prefers-color-scheme: light)">
<style>${baseCss()}${CHROME_CSS}${ART_CSS}</style>
${SITE_JS_TAG}
</head>
<body>
${body}
${siteFooter(chrome(ctx))}
</body>
</html>`;
}

/** Bouton principal : texte, puis une flèche dans sa propre case */
const goButton = (href: string, label: string, extra = '') =>
  `<a class="btn primary${extra}" href="${href}">${label}<span class="go">${ICONS.arrow}</span></a>`;

export function renderLanding(ctx: LandingContext): string {
  const t = translator(ctx);
  const title = ctx.page.title || ctx.operatorName || 'BetterVault';
  const links = ctx.links ?? DEFAULT_LINKS;
  const intro = ctx.page.description
    ? ctx.page.description.split(/\n{2,}/).map(p => `<p class="lede">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : `<p class="lede">${t(
        'Vos mots de passe, vos codes 2FA et vos fichiers sont chiffrés sur votre appareil avant d’arriver ici. Le serveur garde le coffre, sans jamais pouvoir l’ouvrir.',
        'Your passwords, 2FA codes and files are encrypted on your device before they get here. The server keeps the vault without ever being able to open it.')}</p>`;
  const heading = ctx.page.title
    ? escapeHtml(ctx.page.title)
    : t(`Vos secrets, ${highlight('chiffrés chez vous', 'accent')}.`, `Your secrets, ${highlight('encrypted at home', 'accent')}.`);

  const start = ctx.appAvailable ? '/app' : '/docs/guide/premiers-pas';

  const steps = snakeSteps([
    {
      title: t('Créez votre compte', 'Create your account'),
      subtitle: t('Un email et un mot de passe principal.', 'An email and a master password.'),
      text: t('Essayez un mot de passe dans la maquette : il ne quitte jamais la page. Dans l’application non plus il ne part pas, il sert à fabriquer la clé du coffre (Argon2id).', 'Try a password in the mock-up: it never leaves the page. In the app it does not leave either — it derives the vault key (Argon2id).'),
      art: artAccount({ email: 'Email', password: t('Mot de passe principal', 'Master password'), placeholder: t('Tapez un mot de passe…', 'Type a password…'),
        levels: ['', t('Très faible', 'Very weak'), t('Faible', 'Weak'), t('Correct', 'Fair'), t('Solide', 'Strong')], button: t('Créer mon coffre', 'Create my vault'), chip: t('Clé créée sur l’appareil', 'Key made on device') })
    },
    {
      title: t('Ajoutez vos accès', 'Add your logins'),
      subtitle: t('Tout est chiffré avant de partir.', 'Everything is encrypted before it leaves.'),
      text: t('Importez depuis Bitwarden, 1Password, KeePass, Chrome ou un fichier CSV. Le serveur ne reçoit qu’un bloc illisible — basculez la vue pour voir ce qu’il voit.', 'Import from Bitwarden, 1Password, KeePass, Chrome or a CSV file. The server only receives an unreadable blob — switch the view to see what it sees.'),
      art: artCipher({ you: t('Ce que vous voyez', 'What you see'), server: t('Ce que voit le serveur', 'What the server sees'), rows: [['GitHub', 'marie.dupont'], ['Banque', 'n° 04 22 81'], ['Netflix', 'marie@exemple.fr']] })
    },
    {
      title: t('Retrouvez-les partout', 'Find them everywhere'),
      subtitle: t('Web, Windows, Linux et Android.', 'Web, Windows, Linux and Android.'),
      text: t('Chaque appareil reçoit le coffre chiffré et le déchiffre pour lui. Deux modifications faites en même temps sont fusionnées, rien ne se perd.', 'Each device receives the encrypted vault and decrypts it for itself. Two edits made at the same time are merged, nothing is lost.'),
      art: artDevices({ synced: t('Synchronisé', 'Synced'), desktop: 'Windows · Linux', phone: 'Android', web: t('Navigateur', 'Browser') })
    },
    {
      title: t('Vous seul l’ouvrez', 'Only you can open it'),
      subtitle: t('Empreinte, visage ou clé de sécurité.', 'Fingerprint, face or security key.'),
      text: t('Déverrouillez d’un geste et générez vos codes 2FA : un nouveau toutes les 30 secondes, comme dans la maquette. Même l’hébergeur de ce serveur ne peut pas lire votre coffre.', 'Unlock in one gesture and generate your 2FA codes: a new one every 30 seconds, as in the mock-up. Even the operator of this server cannot read your vault.'),
      art: artUnlock({ code: t('Code 2FA · GitHub', '2FA code · GitHub'), unlocked: t('Coffre déverrouillé', 'Vault unlocked'), seconds: t('s', 's') })
    }
  ], t('Étape', 'Step'));

  const faq: Array<[string, string]> = [
    [t('Que se passe-t-il si j’oublie mon mot de passe principal ?', 'What if I forget my master password?'),
     t('La clé de secours, donnée à la création du compte, permet d’en choisir un nouveau. Sans elle, personne — pas même l’hébergeur — ne peut rouvrir le coffre : c’est le prix d’un vrai chiffrement de bout en bout.', 'The recovery key, given when you create the account, lets you choose a new one. Without it nobody — not even the operator — can reopen the vault: that is the price of real end-to-end encryption.')],
    [t('Le serveur peut-il lire mes données ?', 'Can the server read my data?'),
     t('Non. Il stocke des blocs chiffrés en AES-256-GCM avec une clé qu’il n’a jamais reçue. Une fuite de sa base ne révèle aucun mot de passe.', 'No. It stores blocks encrypted with AES-256-GCM using a key it never received. A leak of its database reveals no password.')],
    [t('Sur quels appareils l’utiliser ?', 'Which devices can I use?'),
     t('Aujourd’hui : dans le navigateur, sur Windows, sur Linux et sur Android. macOS et iOS viendront plus tard.', 'Today: in the browser, on Windows, on Linux and on Android. macOS and iOS will come later.')],
    [t('Puis-je partir avec mes données ?', 'Can I leave with my data?'),
     t('Oui : export complet chiffré, fichiers compris, ou formats Bitwarden, 1Password, KeePass et CSV. Le même export s’importe sur un autre serveur BetterVault.', 'Yes: full encrypted export, files included, or Bitwarden, 1Password, KeePass and CSV formats. The same export imports onto another BetterVault server.')],
    [t('Puis-je héberger mon propre serveur ?', 'Can I host my own server?'),
     t('Oui, avec Docker, en quelques minutes. Le code est ouvert et la documentation couvre l’installation, les sauvegardes, la grappe de serveurs et les documents légaux.', 'Yes, with Docker, in a few minutes. The code is open and the documentation covers installation, backups, server clusters and legal documents.')],
    [t('Est-ce gratuit ?', 'Is it free?'),
     (ctx.plans?.length
       ? t('Oui, le compte de base est gratuit. Cet hébergeur propose aussi des offres avec plus d’espace : voir les tarifs.', 'Yes, the basic account is free. This operator also offers plans with more space: see pricing.')
       : t('Oui. Le logiciel est libre, et ce serveur ne propose pas d’offre payante.', 'Yes. The software is open source, and this server offers no paid plan.'))]
  ];

  const official = (ctx.officialServers?.length ?? 0) > 1 ? `
  <section data-reveal>
    <p class="eyebrow">${t('Serveurs officiels', 'Official servers')}</p>
    <h2>${t(`${ctx.officialServers!.length} serveurs, un seul compte`, `${ctx.officialServers!.length} servers, one account`)}</h2>
    <p class="section-lede">${t('Ce service tourne sur plusieurs serveurs reliés en grappe : votre coffre est répliqué entre ceux de votre zone, jamais hors de celle-ci.', 'This service runs on several servers linked in a cluster: your vault is replicated between those in your zone, never outside it.')}</p>
    <ul class="official">${ctx.officialServers!.map(s => `
      <li>${tile('server', 'sm')}<span><strong>${escapeHtml(s.name)}</strong><span class="meta">${escapeHtml([s.region, s.zone].filter(Boolean).join(' · '))}</span></span><span class="dot${s.online ? '' : ' off'}" title="${s.online ? t('En ligne', 'Online') : t('Hors ligne', 'Offline')}"></span></li>`).join('')}
    </ul>
  </section>` : '';

  const body = `${siteHeader(chrome(ctx), 'home')}
<main id="contenu">
  <section class="hero">
    <div>
      <h1>${heading}</h1>
      ${ctx.page.title ? `<p class="meta">${escapeHtml(title)}</p>` : ''}
      ${intro}
      <div class="actions">
        ${goButton(start, t('Premiers pas', 'Get started'))}
        <a class="btn" href="/docs">${icon('files', 20)}${t('Documentation', 'Documentation')}</a>
        <a class="btn" href="${escapeHtml(links.github)}" rel="noopener" title="${t('Code source', 'Source code')}">${ICONS.github}GitHub</a>
      </div>
      <ul class="trust">
        <li>${icon('lockKey', 18)}${t('Chiffré sur l’appareil', 'Encrypted on device')}</li>
        <li>${icon('shield', 18)}${t('Le serveur ne lit rien', 'The server reads nothing')}</li>
        <li>${icon('server', 18)}${t('Libre et auto-hébergeable', 'Open source, self-hostable')}</li>
      </ul>
      <p class="note">${ctx.registrationOpen
        ? t('Inscriptions ouvertes sur ce serveur. Aucune carte bancaire pour commencer.', 'Sign-ups are open on this server. No card needed to start.')
        : t('Ce serveur est sur invitation : demandez un accès à son hébergeur.', 'This server is invitation only: ask its operator for access.')}</p>
    </div>
    ${heroArt({ code: t('Code 2FA', '2FA code'), synced: t('Synchronisé', 'Synced'),
      unlock: [t('Déverrouillé par empreinte', 'Unlocked by fingerprint'), t('Déverrouillé par le visage', 'Unlocked by face'), t('Déverrouillé par clé USB', 'Unlocked by USB key')] })}
  </section>

  <section id="fonctions">
    <div class="center" data-reveal>
      <p class="eyebrow">${t('Fonctionnalités', 'Features')}</p>
      <h2>${t(`Tout tient dans un seul ${circled('coffre')}`, `It all fits in one ${circled('vault')}`)}</h2>
      <p class="section-lede">${t('Vos accès, vos codes et vos documents, rangés au même endroit et lisibles par vous seul.', 'Your logins, codes and documents, kept in one place and readable by you alone.')}</p>
    </div>
    ${vaultFeatures(FEATURES.map(([ic, tf, te, df, de], i) => ({ icon: ic, title: t(tf, te), text: t(df, de), href: FEATURE_DOCS[i] })), t('Lire la doc', 'Read the docs'))}
  </section>

  <section id="comment">
    <div data-reveal>
      <p class="eyebrow">${t('Comment ça marche', 'How it works')}</p>
      <h2>${t(`Quatre étapes, ${underline('aucune clé confiée', 'yellow')}`, `Four steps, ${underline('no key handed over', 'yellow')}`)}</h2>
      <p class="section-lede">${t('De la création du compte au déverrouillage, la clé reste sur vos appareils. Les maquettes ci-dessous se manipulent.', 'From creating the account to unlocking, the key stays on your devices. The mock-ups below are interactive.')}</p>
    </div>
    ${steps}
  </section>

  <div class="band">
    <div class="band-in" data-reveal>
      <span class="safe">${icon('safe', 80)}</span>
      <div>
        <h2>${t('Chiffré de bout en bout, sans exception', 'End-to-end encrypted, no exceptions')}</h2>
        <p>${t('Mots de passe, codes 2FA, notes, tâches, pièces jointes et coffres partagés : tout est chiffré sur l’appareil. Le code est ouvert, chacun peut le vérifier.', 'Passwords, 2FA codes, notes, tasks, attachments and shared vaults: everything is encrypted on the device. The code is open, anyone can check it.')}</p>
        <div class="actions">
          ${goButton(start, t('Premiers pas', 'Get started'))}
          <a class="btn ghost" href="${escapeHtml(links.github)}" rel="noopener">${ICONS.github}${t('Voir le code', 'View the code')}</a>
        </div>
      </div>
    </div>
  </div>

  ${official}

  <section id="questions">
    <div class="faq-head">
      <div data-reveal>
        <p class="eyebrow">FAQ</p>
        <h2>${t(`Des ${underline('questions', 'blue')} ?`, `Any ${underline('questions', 'blue')}?`)}</h2>
        <p class="section-lede">${t('La réponse n’est pas ici ?', 'Answer not here?')} ${links.discord
          ? t(`Posez-la sur <a href="${escapeHtml(links.discord)}" rel="noopener">Discord</a> ou lisez la <a href="/docs">documentation</a>.`, `Ask on <a href="${escapeHtml(links.discord)}" rel="noopener">Discord</a> or read the <a href="/docs">documentation</a>.`)
          : t('Lisez la <a href="/docs">documentation</a>.', 'Read the <a href="/docs">documentation</a>.')}</p>
      </div>
      <div data-reveal>${faqList(faq)}</div>
    </div>
  </section>

  <div class="cta" data-reveal>
    <div>
      <h2>${t('Prêt à ouvrir votre coffre ?', 'Ready to open your vault?')}</h2>
      <p>${t('Quelques secondes pour créer un compte, rien à installer.', 'A few seconds to create an account, nothing to install.')}</p>
    </div>
    <div class="actions" style="margin:0">
      ${goButton(start, t('Premiers pas', 'Get started'))}
      ${chrome(ctx).serversOn ? `<a class="btn" href="/serveurs">${icon('globe', 20)}${t('Choisir un serveur', 'Pick a server')}</a>` : ''}
    </div>
  </div>
</main>`;

  return page(ctx, title, t('Gestionnaire de mots de passe chiffré de bout en bout : mots de passe, codes 2FA, fichiers et tâches.', 'End-to-end encrypted password manager: passwords, 2FA codes, files and tasks.'), body);
}

/* ── Tarifs ─────────────────────────────────────────────────────────────── */

const BOOST_TEXT: Record<string, [string, string, number, string]> = {
  attachmentQuotaBytes: ['d’espace pour les pièces jointes', 'of attachment storage', 1024 ** 3, 'Go'],
  maxAttachmentBytes: ['par pièce jointe', 'per attachment', 1024 ** 2, 'Mo'],
  maxVaultBytes: ['de taille de coffre', 'of vault size', 1024 ** 2, 'Mo'],
  maxVaults: ['coffres', 'vaults', 1, ''],
  maxCredentialsPerVault: ['identifiants par coffre', 'items per vault', 1, '']
};

/** Montant affichable d'un tarif : les champs chiffrés, sinon ce qu'on lit dans le libellé */
function priceParts(p: PublicPlan['prices'][number]): { amount: string; currency: string; period: 'month' | 'year' | 'once' } {
  const period = p.interval ?? (/\b(an|année|year|annual|yearly)\b/i.test(p.label) ? 'year' : /\b(mois|month|monthly)\b/i.test(p.label) ? 'month' : 'once');
  if (p.amount !== undefined) {
    const value = p.amount / 100;
    return { amount: Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ','), currency: (p.currency ?? 'eur').toUpperCase() === 'EUR' ? '€' : (p.currency ?? '').toUpperCase(), period };
  }
  const m = /(\d+(?:[.,]\d{1,2})?)\s*(€|\$|£|CHF)?/.exec(p.label);
  return { amount: m?.[1] ?? p.label, currency: m?.[2] ?? '', period };
}

export function renderPlansPage(ctx: LandingContext): string | null {
  const plans = ctx.plans ?? [];
  if (!plans.length) return null;
  const t = translator(ctx);
  const hasYear = plans.some(p => p.prices.some(pr => priceParts(pr).period === 'year'));
  const hasMonth = plans.some(p => p.prices.some(pr => priceParts(pr).period === 'month'));
  const toggle = hasYear && hasMonth;
  const colors = ['#3aa0f0', '#f05a5f', '#1fc7b0', '#ffb21e'];
  const free = ctx.freeLimits;

  const priceBlock = (pr: PublicPlan['prices'][number], cls: string) => {
    const { amount, currency, period } = priceParts(pr);
    const per = period === 'month' ? t('/ mois', '/ month') : period === 'year' ? t('/ an', '/ year') : t('une fois', 'once');
    const [ent, dec] = amount.split(',');
    return `<div class="price ${cls}"><span class="cur">${escapeHtml(currency)}</span><span class="amount">${escapeHtml(ent)}</span>${dec ? `<span class="dec">,${escapeHtml(dec)}</span>` : ''}<span class="per">${per}</span></div>`;
  };

  const cards = plans.map((plan, i) => {
    const monthly = plan.prices.find(pr => priceParts(pr).period === 'month');
    const yearly = plan.prices.find(pr => priceParts(pr).period === 'year');
    const first = plan.prices[0];
    const prices = toggle
      ? `${yearly ? priceBlock(yearly, 'p-year') : priceBlock(monthly ?? first, 'p-year')}${monthly ? priceBlock(monthly, 'p-month') : priceBlock(yearly ?? first, 'p-month')}`
      : first ? priceBlock(first, '') : '';
    const perks = Object.entries(plan.boosts).filter(([, v]) => v).map(([key, v]) => {
      const [fr, en, unit, suffix] = BOOST_TEXT[key] ?? [key, key, 1, ''];
      const value = Math.round(((v as number) / unit) * 10) / 10;
      return `<li>${icon('check', 18)}<span>+ <b>${value}${suffix ? ` ${suffix}` : ''}</b> ${t(fr, en)}</span></li>`;
    }).join('');
    return `<article class="plan" style="--c:${colors[(i + 1) % colors.length]}" data-reveal>
      <h2>${escapeHtml(plan.name)}</h2>
      ${prices}
      ${plan.description ? `<p class="plan-desc">${escapeHtml(plan.description)}</p>` : ''}
      <ul class="perks"><li>${icon('check', 18)}<span>${t('Tout le compte gratuit', 'Everything in the free account')}</span></li>${perks}</ul>
      ${ctx.appAvailable ? `<a class="btn primary" href="/app">${t('Choisir cette offre', 'Choose this plan')}<span class="go">${ICONS.arrow}</span></a>` : ''}
    </article>`;
  }).join('');

  const freeCard = `<article class="plan" style="--c:${colors[0]}" data-reveal>
    <h2>${t('Gratuit', 'Free')}</h2>
    <div class="price"><span class="cur">€</span><span class="amount">0</span><span class="per">${t('pour toujours', 'forever')}</span></div>
    <p class="plan-desc">${t('Le chiffrement de bout en bout, la synchronisation et la 2FA, sans carte bancaire.', 'End-to-end encryption, sync and 2FA, no card needed.')}</p>
    <ul class="perks">
      ${free ? `<li>${icon('check', 18)}<span><b>${free.maxVaults}</b> ${t('coffres', 'vaults')}</span></li>
      <li>${icon('check', 18)}<span><b>${free.maxCredentialsPerVault}</b> ${t('identifiants par coffre', 'items per vault')}</span></li>
      ${free.attachmentQuotaBytes ? `<li>${icon('check', 18)}<span><b>${Math.round(free.attachmentQuotaBytes / 1024 ** 2)} Mo</b> ${t('de pièces jointes', 'of attachments')}</span></li>` : ''}` : ''}
      <li>${icon('check', 18)}<span>${t('Web, Windows, Linux, Android', 'Web, Windows, Linux, Android')}</span></li>
    </ul>
    ${ctx.appAvailable ? `<a class="btn" href="/app">${t('Commencer gratuitement', 'Start for free')}</a>` : ''}
  </article>`;

  const faq = faqList([
    [t('Le paiement passe-t-il par BetterVault ?', 'Does payment go through BetterVault?'), t('Non. Le paiement se fait sur Stripe : ni la carte ni l’adresse de facturation ne passent par ce serveur.', 'No. Payment happens on Stripe: neither the card nor the billing address go through this server.')],
    [t('Puis-je arrêter quand je veux ?', 'Can I stop anytime?'), t('Oui. L’abonnement s’arrête à la fin de la période payée ; vos données restent, seules les limites du compte gratuit s’appliquent de nouveau.', 'Yes. The subscription ends at the end of the paid period; your data stays, only the free account limits apply again.')],
    [t('Que se passe-t-il si je dépasse les limites gratuites ?', 'What if I exceed the free limits?'), t('Rien n’est supprimé. Vous ne pouvez simplement plus ajouter d’éléments au-delà de la limite tant que l’espace n’est pas libéré ou étendu.', 'Nothing is deleted. You simply cannot add items beyond the limit until space is freed or extended.')]
  ]);

  const body = `${siteHeader(chrome(ctx), 'plans')}
<main id="contenu">
  <section class="center" data-reveal>
    <p class="eyebrow">${t('Tarifs', 'Pricing')}</p>
    <h1>${t(`Gratuit pour commencer, ${highlight('simple', 'yellow')} ensuite`, `Free to start, ${highlight('simple', 'yellow')} after`)}</h1>
    <p class="lede" style="margin:0 auto">${t('Le chiffrement, la synchronisation et la 2FA sont dans le compte gratuit. Les offres ajoutent de l’espace.', 'Encryption, sync and 2FA are in the free account. Plans add space.')}</p>
  </section>
  <div class="plans-wrap">
    ${toggle ? `<input type="radio" name="periode" id="per-year" checked><input type="radio" name="periode" id="per-month">
    <div class="period"><label for="per-year">${t('Par an', 'Yearly')}</label><span class="switch" aria-hidden="true"></span><label for="per-month">${t('Par mois', 'Monthly')}</label></div>` : ''}
    <div class="plans">${freeCard}${cards}</div>
  </div>
  <section>
    <div class="faq-head">
      <div data-reveal><h2>${t(`Des ${underline('questions', 'red')} ?`, `Any ${underline('questions', 'red')}?`)}</h2>
      <p class="section-lede">${t('Tout ce qu’il faut savoir sur les offres.', 'Everything to know about plans.')}</p></div>
      <div data-reveal>${faq}</div>
    </div>
  </section>
</main>
<style>
.plans-wrap{position:relative;margin-top:44px}
.plans-wrap>input{position:absolute;opacity:0;pointer-events:none}
.period{display:flex;align-items:center;justify-content:center;gap:12px;width:fit-content;margin:0 auto 36px;padding:6px 14px;border-radius:8px;background:var(--card);border:1px solid var(--border);font-weight:650;font-size:14.5px}
.period label{cursor:pointer;color:var(--muted);transition:color .15s}
.switch{position:relative;width:46px;height:26px;border-radius:13px;background:color-mix(in srgb,var(--muted) 22%,transparent);border:1px solid var(--border)}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--accent);transition:transform .2s}
#per-year:checked~.period label[for=per-year],#per-month:checked~.period label[for=per-month]{color:var(--text)}
#per-month:checked~.period .switch::after{transform:translateX(20px)}
#per-year:checked~.plans .p-month,#per-month:checked~.plans .p-year{display:none}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;align-items:stretch}
.plan{display:flex;flex-direction:column;gap:14px;padding:28px 24px 24px;border-radius:8px;background:var(--card);border:1px solid var(--border);border-top:6px solid var(--c);box-shadow:0 30px 60px -40px rgba(0,0,0,.6);transition:transform .2s,box-shadow .2s}
.plan:hover{transform:translateY(-4px);box-shadow:0 40px 70px -40px color-mix(in srgb,var(--c) 70%,transparent)}
.plan h2{font-size:24px;margin:0}
.price{display:flex;align-items:flex-start;gap:2px;color:var(--c);line-height:1}
.price .cur{font-size:26px;font-weight:700;margin-top:6px}
.price .amount{font-size:64px;font-weight:800;letter-spacing:-.04em}
.price .dec{font-size:28px;font-weight:700;margin-top:6px}
.price .per{align-self:flex-end;margin:0 0 8px 8px;color:var(--muted);font-size:14px;font-weight:500}
.plan-desc{margin:0;color:var(--muted);font-size:14.5px}
.perks{list-style:none;padding:0;margin:4px 0 8px;display:flex;flex-direction:column;gap:9px;flex:1}
.perks li{display:flex;gap:10px;align-items:flex-start;font-size:14.5px}
.perks .ph{color:var(--c);margin-top:1px}
.plan .btn{width:100%}
</style>`;
  return page(ctx, t('Tarifs · BetterVault', 'Pricing · BetterVault'), t('Les offres de ce serveur BetterVault.', 'The plans of this BetterVault server.'), body);
}

/**
 * Page des serveurs recommandés par l'hébergeur. Chaque serveur a ses propres
 * comptes : la page le dit avant la liste, pour qu'on ne cherche pas son
 * compte sur un autre serveur. Rien n'y figure que l'hébergeur n'ait saisi.
 */
export function renderServersPage(ctx: LandingContext): string | null {
  if (!ctx.page.directoryEnabled || ctx.page.servers.length === 0) return null;
  const t = translator(ctx);
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
.servers li{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px}
.server-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.server-main code{color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>`;
  return page(ctx, t('Serveurs BetterVault', 'BetterVault servers'), t('Serveurs BetterVault recommandés par cet hébergeur.', 'BetterVault servers recommended by this operator.'), body);
}
