/**
 * En-tête et pied de page communs aux pages publiques : accueil, tarifs,
 * serveurs, documentation et documents légaux. Une seule barre, un seul pied,
 * partout : le logo ramène toujours à l'accueil.
 *
 * Tout fonctionne sans script (menu mobile et choix de langue en <details>,
 * langue par lien) ; /site.js ajoute seulement du confort. Les couleurs
 * viennent des variables de la page (--bg, --card, --border, --text, --muted,
 * --accent).
 */

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type SiteSection = 'home' | 'plans' | 'servers' | 'docs' | 'legal';

/** Liens communautaires : GitHub et BetterCommunity toujours, Discord et page d'état s'ils sont connus */
export interface SiteLinks {
  github: string;
  community: string;
  discord?: string;
  status?: string;
}

export const DEFAULT_LINKS: SiteLinks = {
  github: 'https://github.com/FreeProject089/BetterVault',
  community: 'https://bettercommunity.ch'
};

export interface ChromeContext {
  locale: 'fr' | 'en';
  appAvailable: boolean;
  serversOn: boolean;
  legalEnabled: boolean;
  version: string;
  operatorName: string;
  /** Page des tarifs publiée (offres payantes actives) */
  plansOn?: boolean;
  links?: SiteLinks;
  /** Chemin de la page courante, pour le lien de changement de langue */
  path?: string;
}

/** Langues des pages publiques */
const LANGS: Array<{ code: 'fr' | 'en'; label: string }> = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' }
];

const logo = (size: number) =>
  `<picture><source srcset="/admin/logo-on-light.svg" media="(prefers-color-scheme: light)"><img src="/admin/logo-on-dark.svg" alt="" width="${size}" height="${size}"></picture>`;

const svg = (body: string, size = 18, extra = '') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${extra}>${body}</svg>`;

/** Icônes de marque (Simple Icons, CC0) et quelques pictogrammes au trait */
export const ICONS = {
  github: svg('<path fill="currentColor" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6.1-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/>'),
  discord: svg('<path fill="currentColor" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/>'),
  community: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
  status: svg('<path d="M3 12h4l2.5-6 4 12 2.5-6H21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'),
  globe: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8"/>', 16),
  chevron: svg('<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>', 14, 'class="chev"'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>', 16)
};

/**
 * Choix de langue : rien sous deux langues, une bascule à deux, un menu
 * déroulant au-delà. Le lien pose ?lang=, que le serveur retient.
 */
export function langSwitch(ctx: ChromeContext, where: 'bar' | 'footer'): string {
  if (LANGS.length < 2) return '';
  const path = ctx.path ?? '/';
  const href = (code: string) => `${path}${path.includes('?') ? '&' : '?'}lang=${code}`;
  const current = LANGS.find(l => l.code === ctx.locale) ?? LANGS[0];
  if (LANGS.length === 2) {
    const other = LANGS.find(l => l.code !== current.code)!;
    return `<a class="lang-toggle lang-${where}" href="${href(other.code)}" hreflang="${other.code}" lang="${other.code}" title="${escapeHtml(other.label)}">${ICONS.globe}<span class="lang-cur">${current.code.toUpperCase()}</span><span class="lang-sep" aria-hidden="true">/</span><span>${other.code.toUpperCase()}</span></a>`;
  }
  return `<details class="lang-menu lang-${where}"><summary>${ICONS.globe}<span>${current.code.toUpperCase()}</span>${ICONS.chevron}</summary><div>${LANGS.map(l =>
    `<a href="${href(l.code)}" hreflang="${l.code}" lang="${l.code}"${l.code === current.code ? ' aria-current="true"' : ''}>${escapeHtml(l.label)}</a>`).join('')}</div></details>`;
}

export function siteHeader(ctx: ChromeContext, current: SiteSection): string {
  const t = (a: string, b: string) => (ctx.locale === 'fr' ? a : b);
  const cur = (s: SiteSection) => (s === current ? ' aria-current="page"' : '');
  const links = ctx.links ?? DEFAULT_LINKS;
  const nav = `
      <a href="/#fonctions">${t('Fonctionnalités', 'Features')}</a>
      <a href="/#comment">${t('Comment ça marche', 'How it works')}</a>
      ${ctx.plansOn ? `<a href="/tarifs"${cur('plans')}>${t('Tarifs', 'Pricing')}</a>` : ''}
      ${ctx.serversOn ? `<a href="/serveurs"${cur('servers')}>${t('Serveurs', 'Servers')}</a>` : ''}
      <a href="/docs"${cur('docs')}>${t('Documentation', 'Docs')}</a>`;
  return `<a class="skip" href="#contenu">${t('Aller au contenu', 'Skip to content')}</a>
<header class="site-bar"><div class="site-bar-in">
  <a class="site-brand" href="/" aria-label="${t('BetterVault, accueil', 'BetterVault, home')}">${logo(28)}<span>BetterVault</span></a>
  <nav class="site-links" aria-label="${t('Navigation principale', 'Main navigation')}">${nav}</nav>
  <div class="site-actions">
    ${langSwitch(ctx, 'bar')}
    <a class="site-icon" href="${escapeHtml(links.github)}" rel="noopener" title="${t('Code source sur GitHub', 'Source code on GitHub')}" aria-label="GitHub">${ICONS.github}</a>
    ${links.discord ? `<a class="site-icon" href="${escapeHtml(links.discord)}" rel="noopener" title="Discord" aria-label="Discord">${ICONS.discord}</a>` : ''}
    ${ctx.appAvailable ? `<a class="site-login" href="/app">${t('Se connecter', 'Sign in')}</a>
    <a class="site-cta" href="/app"><span>${t('Premiers pas', 'Get started')}</span><i>${ICONS.arrow}</i></a>` : ''}
  </div>
  <details class="site-menu">
    <summary aria-label="${t('Menu', 'Menu')}"><span></span><span></span><span></span></summary>
    <nav aria-label="${t('Menu', 'Menu')}">${nav}
      ${ctx.appAvailable ? `<a href="/app">${t('Se connecter', 'Sign in')}</a>` : ''}
      <a href="${escapeHtml(links.github)}" rel="noopener">${ICONS.github} GitHub</a>
      ${links.discord ? `<a href="${escapeHtml(links.discord)}" rel="noopener">${ICONS.discord} Discord</a>` : ''}
    </nav>
  </details>
</div></header>`;
}

export function siteFooter(ctx: ChromeContext): string {
  const t = (a: string, b: string) => (ctx.locale === 'fr' ? a : b);
  const q = ctx.locale === 'en' ? '?lang=en' : '';
  const links = ctx.links ?? DEFAULT_LINKS;
  /*
   * Colonnes en <details> : ouvertes par défaut (lisibles sans script), /site.js
   * les replie sur un écran étroit, où elles deviennent un accordéon.
   */
  const col = (title: string, items: string) => `<details class="site-footer-col" open><summary>${title}${ICONS.chevron}</summary><div>${items}</div></details>`;
  return `<footer class="site-footer"><div class="site-footer-in">
  <div class="site-footer-brand">
    <a class="site-brand" href="/">${logo(30)}<span>BetterVault</span></a>
    <p>${t('Gestionnaire de mots de passe, codes 2FA et tâches, chiffré de bout en bout. Libre et auto-hébergeable.', 'Password, 2FA code and task manager, end-to-end encrypted. Open source and self-hostable.')}</p>
    <div class="site-social">
      <a href="${escapeHtml(links.github)}" rel="noopener" aria-label="GitHub" title="GitHub">${ICONS.github}</a>
      ${links.discord ? `<a href="${escapeHtml(links.discord)}" rel="noopener" aria-label="Discord" title="Discord">${ICONS.discord}</a>` : ''}
      <a href="${escapeHtml(links.community)}" rel="noopener" aria-label="BetterCommunity" title="BetterCommunity">${ICONS.community}</a>
    </div>
  </div>
  ${col(t('Produit', 'Product'), `
    <a href="/#fonctions">${t('Fonctionnalités', 'Features')}</a>
    <a href="/#comment">${t('Comment ça marche', 'How it works')}</a>
    ${ctx.plansOn ? `<a href="/tarifs">${t('Tarifs', 'Pricing')}</a>` : ''}
    ${ctx.serversOn ? `<a href="/serveurs">${t('Serveurs', 'Servers')}</a>` : ''}
    ${ctx.appAvailable ? `<a href="/app">${t('Ouvrir l’application', 'Open the app')}</a>` : ''}`)}
  ${col(t('Ressources', 'Resources'), `
    <a href="/docs">${t('Documentation', 'Documentation')}</a>
    <a href="/docs/guide/premiers-pas">${t('Guide de démarrage', 'Getting started')}</a>
    <a href="/docs/deploiement/installation">${t('Héberger son serveur', 'Host your own server')}</a>
    <a href="${escapeHtml(links.github)}" rel="noopener">${t('Code source', 'Source code')}</a>`)}
  ${col(t('Communauté', 'Community'), `
    <a href="${escapeHtml(links.community)}" rel="noopener">BetterCommunity</a>
    ${links.discord ? `<a href="${escapeHtml(links.discord)}" rel="noopener">Discord</a>` : ''}
    ${links.status ? `<a href="${escapeHtml(links.status)}" rel="noopener">${ICONS.status}${t('État du service', 'Service status')}</a>` : ''}
    ${ctx.legalEnabled ? `<a href="/legal/privacy${q}">${t('Confidentialité', 'Privacy')}</a>
    <a href="/legal/terms${q}">${t('Conditions', 'Terms')}</a>` : ''}
    <a href="/admin">${t('Administration', 'Administration')}</a>`)}
</div>
<div class="site-footer-bottom">
  <span>© ${new Date().getFullYear()} ${escapeHtml(ctx.operatorName || 'BetterVault')} · v${escapeHtml(ctx.version)}</span>
  <span class="site-footer-meta">
    ${langSwitch(ctx, 'footer')}
    <span class="site-credits">${t('Icônes', 'Icons')} : <a href="https://www.svgrepo.com/svg/384889/money-safe-safebox" rel="noopener">wishforge.games</a>, <a href="https://phosphoricons.com" rel="noopener">Phosphor</a></span>
  </span>
</div></footer>`;
}

export const CHROME_CSS = `
.skip{position:absolute;left:-9999px}.skip:focus{left:12px;top:12px;z-index:20;background:var(--card);padding:8px 12px;border-radius:8px}
.site-bar{position:sticky;top:0;z-index:10;border-bottom:1px solid color-mix(in srgb,var(--border) 70%,transparent);
  background:color-mix(in srgb,var(--bg) 80%,transparent);backdrop-filter:saturate(1.5) blur(16px);-webkit-backdrop-filter:saturate(1.5) blur(16px)}
.site-bar-in{max-width:1180px;margin:0 auto;padding:0 20px;height:64px;display:flex;align-items:center;gap:6px}
.site-brand{display:inline-flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-weight:750;font-size:16px;letter-spacing:-.01em}
.site-brand picture{display:flex}.site-brand img{display:block}
.site-bar .site-brand{margin-right:20px;padding:6px 8px 6px 4px;border-radius:8px;transition:background-color .15s}
.site-bar .site-brand:hover{background:color-mix(in srgb,var(--muted) 10%,transparent)}
.site-links{display:flex;align-items:center;gap:2px;margin-right:auto}
.site-links a{position:relative;display:inline-flex;align-items:center;min-height:38px;padding:0 12px;border-radius:8px;color:var(--muted);text-decoration:none;font-size:14px;font-weight:550;transition:color .15s,background-color .15s}
.site-links a:hover{color:var(--text);background:color-mix(in srgb,var(--muted) 10%,transparent)}
.site-links a[aria-current]{color:var(--text)}
.site-links a[aria-current]::after{content:"";position:absolute;left:12px;right:12px;bottom:3px;height:2px;border-radius:2px;background:var(--accent)}
.site-actions{display:flex;align-items:center;gap:4px}
.site-icon{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;color:var(--muted);transition:color .15s,background-color .15s}
.site-icon:hover{color:var(--text);background:color-mix(in srgb,var(--muted) 10%,transparent)}
.site-login{display:inline-flex;align-items:center;min-height:38px;padding:0 12px;border-radius:8px;color:var(--text);text-decoration:none;font-size:14px;font-weight:600;transition:background-color .15s}
.site-login:hover{background:color-mix(in srgb,var(--muted) 10%,transparent)}
.site-cta{display:inline-flex;align-items:center;gap:10px;min-height:38px;padding:0 5px 0 14px;margin-left:4px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-size:14px;font-weight:650;
  box-shadow:0 8px 20px -10px var(--accent),inset 0 1px 0 rgba(255,255,255,.2);transition:filter .15s,box-shadow .15s}
.site-cta i{display:grid;place-items:center;width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,.2);transition:transform .2s,background-color .2s}
.site-cta:hover{filter:brightness(1.07);box-shadow:0 12px 26px -10px var(--accent),inset 0 1px 0 rgba(255,255,255,.2)}
.site-cta:hover i{transform:translateX(2px);background:rgba(255,255,255,.3)}
.site-cta:active i{transform:translateX(4px)}
.lang-toggle{display:inline-flex;align-items:center;gap:5px;min-height:38px;padding:0 10px;border-radius:8px;color:var(--muted);text-decoration:none;font:600 12.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;transition:color .15s,background-color .15s}
.lang-toggle:hover{color:var(--text);background:color-mix(in srgb,var(--muted) 10%,transparent)}
.lang-toggle .lang-cur{color:var(--text)}.lang-toggle .lang-sep{opacity:.5}
.lang-menu{position:relative}
.lang-menu summary{list-style:none;display:inline-flex;align-items:center;gap:6px;min-height:38px;padding:0 10px;border-radius:8px;cursor:pointer;color:var(--muted);font-weight:600;font-size:13px}
.lang-menu summary::-webkit-details-marker{display:none}
.lang-menu[open] .chev{transform:rotate(180deg)}
.lang-menu>div{position:absolute;right:0;top:44px;min-width:150px;display:flex;flex-direction:column;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--card);box-shadow:0 20px 40px -20px rgba(0,0,0,.5);z-index:5}
.lang-menu>div a{padding:8px 10px;border-radius:6px;color:var(--text);text-decoration:none;font-size:14px}
.lang-menu>div a:hover,.lang-menu>div a[aria-current]{background:color-mix(in srgb,var(--accent) 14%,transparent)}
.chev{transition:transform .2s;flex:0 0 auto}
.site-menu{display:none;position:relative}
.site-menu summary{list-style:none;display:grid;place-content:center;gap:4px;width:42px;height:42px;border-radius:8px;cursor:pointer}
.site-menu summary::-webkit-details-marker{display:none}
.site-menu summary span{display:block;width:18px;height:2px;border-radius:2px;background:var(--text);transition:transform .2s,opacity .2s}
.site-menu[open] summary span:nth-child(1){transform:translateY(6px) rotate(45deg)}
.site-menu[open] summary span:nth-child(2){opacity:0}
.site-menu[open] summary span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.site-menu nav{position:absolute;right:0;top:50px;min-width:240px;display:flex;flex-direction:column;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--card);box-shadow:0 24px 48px -20px rgba(0,0,0,.5);animation:drop .18s ease-out}
.site-menu nav a{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border-radius:6px;color:var(--text);text-decoration:none;font-size:15px}
.site-menu nav a:hover{background:color-mix(in srgb,var(--muted) 10%,transparent)}
@keyframes drop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@media (max-width:960px){.site-links{display:none}.site-bar .site-brand{margin-right:auto}.site-menu{display:block}}
@media (max-width:640px){.site-login,.site-bar .site-icon{display:none}}
@media (max-width:420px){.site-cta span{display:none}.site-cta{padding:0 5px}.site-bar .site-brand span{display:none}.lang-bar .lang-sep,.lang-bar .lang-sep+span{display:none}}

.site-footer{border-top:1px solid var(--border);background:color-mix(in srgb,var(--card) 55%,var(--bg));font-size:14px}
.site-footer-in{max-width:1180px;margin:0 auto;padding:52px 20px 28px;display:grid;grid-template-columns:minmax(0,1.5fr) repeat(3,minmax(0,1fr));gap:36px}
.site-footer-brand p{color:var(--muted);margin:12px 0 16px;max-width:34ch;line-height:1.55}
.site-social{display:flex;gap:6px}
.site-social a{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;border:1px solid var(--border);color:var(--muted);transition:color .15s,border-color .15s,transform .15s}
.site-social a:hover{color:var(--text);border-color:var(--accent);transform:translateY(-2px)}
.site-footer-col>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;color:var(--text);margin:4px 0 10px;pointer-events:none}
.site-footer-col>summary::-webkit-details-marker{display:none}
.site-footer-col>summary .chev{display:none}
.site-footer-col>div{display:flex;flex-direction:column;gap:2px}
.site-footer-col a{display:inline-flex;align-items:center;gap:8px;color:var(--muted);text-decoration:none;padding:5px 0;width:fit-content;transition:color .15s}
.site-footer-col a:hover{color:var(--text)}
.site-footer-bottom{max-width:1180px;margin:0 auto;padding:16px 20px 26px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 20px;color:var(--muted);font-size:12.5px}
.site-footer-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px}
.site-footer-bottom a{color:var(--muted)}
.site-footer-bottom .lang-toggle{min-height:32px;border:1px solid var(--border)}
@media (max-width:760px){
  .site-footer-in{grid-template-columns:1fr;gap:6px;padding-top:36px}
  .site-footer-brand{margin-bottom:18px}
  .site-footer-col{border-top:1px solid var(--border)}
  .site-footer-col>summary{pointer-events:auto;cursor:pointer;min-height:50px;margin:0}
  .site-footer-col>summary .chev{display:block}
  .site-footer-col[open]>summary .chev{transform:rotate(180deg)}
  .site-footer-col>div{padding-bottom:12px}
}
`;
