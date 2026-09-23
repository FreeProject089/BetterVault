/**
 * En-tête et pied de page communs aux pages publiques : accueil, serveurs,
 * documentation et documents légaux. Une seule barre, un seul pied, partout :
 * le logo ramène toujours à l'accueil.
 *
 * Aucune page publique n'exécute de script : le menu mobile est un <details>.
 * Les couleurs viennent des variables de la page (--bg, --card, --border,
 * --text, --muted, --accent).
 */

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type SiteSection = 'home' | 'servers' | 'docs' | 'legal';

export interface ChromeContext {
  locale: 'fr' | 'en';
  appAvailable: boolean;
  serversOn: boolean;
  legalEnabled: boolean;
  version: string;
  operatorName: string;
}

const logo = (size: number) =>
  `<picture><source srcset="/admin/logo-on-light.svg" media="(prefers-color-scheme: light)"><img src="/admin/logo-on-dark.svg" alt="" width="${size}" height="${size}"></picture>`;

export function siteHeader(ctx: ChromeContext, current: SiteSection): string {
  const t = (a: string, b: string) => (ctx.locale === 'fr' ? a : b);
  const cur = (s: SiteSection) => (s === current ? ' aria-current="page"' : '');
  const links = `
      <a href="/#fonctions">${t('Fonctionnalités', 'Features')}</a>
      <a href="/#comment">${t('Comment ça marche', 'How it works')}</a>
      ${ctx.serversOn ? `<a href="/serveurs"${cur('servers')}>${t('Serveurs', 'Servers')}</a>` : ''}
      <a href="/docs"${cur('docs')}>${t('Documentation', 'Documentation')}</a>`;
  const app = ctx.appAvailable
    ? `<a class="site-login" href="/app">${t('Se connecter', 'Sign in')}</a>
      <a class="site-cta" href="/app">${t('Premiers pas', 'Get started')}<span aria-hidden="true">→</span></a>`
    : '';
  return `<a class="skip" href="#contenu">${t('Aller au contenu', 'Skip to content')}</a>
<header class="site-bar"><div class="site-bar-in">
  <a class="site-brand" href="/" aria-label="${t('BetterVault, accueil', 'BetterVault, home')}">${logo(28)}<span>BetterVault</span></a>
  <nav class="site-links" aria-label="${t('Navigation principale', 'Main navigation')}">${links}</nav>
  <div class="site-actions">${app}</div>
  <details class="site-menu">
    <summary aria-label="${t('Menu', 'Menu')}"><span></span><span></span><span></span></summary>
    <nav aria-label="${t('Menu', 'Menu')}">${links}${ctx.appAvailable ? `<a href="/app">${t('Se connecter', 'Sign in')}</a>` : ''}</nav>
  </details>
</div></header>`;
}

export function siteFooter(ctx: ChromeContext): string {
  const t = (a: string, b: string) => (ctx.locale === 'fr' ? a : b);
  const q = ctx.locale === 'en' ? '?lang=en' : '';
  return `<footer class="site-footer"><div class="site-footer-in">
  <div class="site-footer-brand">
    <a class="site-brand" href="/">${logo(30)}<span>BetterVault</span></a>
    <p>${t('Gestionnaire de mots de passe chiffré de bout en bout. Le serveur garde le coffre sans pouvoir l’ouvrir.', 'End-to-end encrypted password manager. The server keeps the vault without being able to open it.')}</p>
    <span class="site-pill"><i></i>${t('Chiffré sur l’appareil', 'Encrypted on device')}</span>
  </div>
  <div class="site-footer-col">
    <h2>${t('Produit', 'Product')}</h2>
    <a href="/#fonctions">${t('Fonctionnalités', 'Features')}</a>
    <a href="/#comment">${t('Comment ça marche', 'How it works')}</a>
    ${ctx.serversOn ? `<a href="/serveurs">${t('Serveurs', 'Servers')}</a>` : ''}
    ${ctx.appAvailable ? `<a href="/app">${t('Ouvrir l’application', 'Open the app')}</a>` : ''}
  </div>
  <div class="site-footer-col">
    <h2>${t('Ressources', 'Resources')}</h2>
    <a href="/docs">${t('Documentation', 'Documentation')}</a>
    <a href="/docs/guide/premiers-pas">${t('Guide de démarrage', 'Getting started guide')}</a>
    <a href="/docs/deploiement/installation">${t('Héberger son serveur', 'Host your own server')}</a>
    <a href="/docs/securite">${t('Sécurité', 'Security')}</a>
  </div>
  <div class="site-footer-col">
    <h2>${t('Ce serveur', 'This server')}</h2>
    ${ctx.legalEnabled ? `<a href="/legal/privacy${q}">${t('Confidentialité', 'Privacy')}</a>
    <a href="/legal/terms${q}">${t('Conditions', 'Terms')}</a>` : ''}
    <a href="/admin">${t('Administration', 'Administration')}</a>
  </div>
</div>
<div class="site-footer-bottom">
  <span>© ${new Date().getFullYear()} ${escapeHtml(ctx.operatorName || 'BetterVault')} · BetterVault ${escapeHtml(ctx.version)}</span>
  <span>${t('Icône du coffre', 'Vault icon')} : <a href="https://www.svgrepo.com/svg/384889/money-safe-safebox" rel="noopener">wishforge.games</a> (CC BY) · ${t('Icônes', 'Icons')} : <a href="https://phosphoricons.com" rel="noopener">Phosphor</a> (MIT)</span>
</div></footer>`;
}

export const CHROME_CSS = `
.skip{position:absolute;left:-9999px}.skip:focus{left:12px;top:12px;z-index:20;background:var(--card);padding:8px 12px;border-radius:8px}
.site-bar{position:sticky;top:0;z-index:10;border-bottom:1px solid color-mix(in srgb,var(--border) 70%,transparent);
  background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px)}
.site-bar-in{max-width:1180px;margin:0 auto;padding:0 20px;height:64px;display:flex;align-items:center;gap:8px}
.site-brand{display:inline-flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-weight:700;font-size:16px;letter-spacing:-.01em}
.site-brand picture{display:flex}.site-brand img{display:block}
.site-bar .site-brand{margin-right:18px}
.site-links{display:flex;align-items:center;gap:2px;margin-right:auto}
.site-links a,.site-menu nav a{display:inline-flex;align-items:center;min-height:40px;padding:0 12px;border-radius:10px;color:var(--muted);text-decoration:none;font-size:14px;font-weight:500;transition:color .15s,background-color .15s}
.site-links a:hover,.site-links a[aria-current]{color:var(--text);background:color-mix(in srgb,var(--muted) 12%,transparent)}
.site-actions{display:flex;align-items:center;gap:6px}
.site-login{display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border-radius:10px;color:var(--text);text-decoration:none;font-size:14px;font-weight:600}
.site-login:hover{background:color-mix(in srgb,var(--muted) 12%,transparent)}
.site-cta{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 16px;border-radius:999px;background:var(--accent);color:#fff;text-decoration:none;font-size:14px;font-weight:600;
  box-shadow:0 8px 22px -10px var(--accent),inset 0 1px 0 rgba(255,255,255,.18);transition:transform .15s,filter .15s}
.site-cta span{transition:transform .15s}
.site-cta:hover{filter:brightness(1.08)}.site-cta:hover span{transform:translateX(3px)}
.site-menu{display:none;position:relative}
.site-menu summary{list-style:none;display:grid;place-content:center;gap:4px;width:44px;height:44px;border-radius:10px;cursor:pointer}
.site-menu summary::-webkit-details-marker{display:none}
.site-menu summary span{display:block;width:18px;height:2px;border-radius:2px;background:var(--text);transition:transform .2s,opacity .2s}
.site-menu[open] summary span:nth-child(1){transform:translateY(6px) rotate(45deg)}
.site-menu[open] summary span:nth-child(2){opacity:0}
.site-menu[open] summary span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.site-menu nav{position:absolute;right:0;top:52px;min-width:230px;display:flex;flex-direction:column;padding:8px;border:1px solid var(--border);border-radius:14px;background:var(--card);box-shadow:0 24px 48px -20px rgba(0,0,0,.5)}
.site-menu nav a{min-height:44px;color:var(--text)}
@media (max-width:860px){.site-links{display:none}.site-login{display:none}.site-menu{display:block}.site-bar .site-brand{margin-right:auto}}
@media (max-width:420px){.site-cta{padding:0 12px}.site-brand span{display:none}}

.site-footer{margin-top:0;border-top:1px solid var(--border);background:color-mix(in srgb,var(--card) 60%,var(--bg));font-size:14px}
.site-footer-in{max-width:1180px;margin:0 auto;padding:48px 20px 28px;display:grid;grid-template-columns:minmax(0,1.6fr) repeat(3,minmax(0,1fr));gap:32px}
.site-footer-brand p{color:var(--muted);margin:12px 0 14px;max-width:36ch;line-height:1.55}
.site-pill{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid var(--border);color:var(--muted)}
.site-pill i{width:7px;height:7px;border-radius:50%;background:#3fb950;box-shadow:0 0 0 3px color-mix(in srgb,#3fb950 25%,transparent)}
.site-footer-col{display:flex;flex-direction:column;gap:2px}
.site-footer-col h2{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text);margin:4px 0 8px}
.site-footer-col a{color:var(--muted);text-decoration:none;padding:5px 0;width:fit-content}
.site-footer-col a:hover{color:var(--text)}
.site-footer-bottom{max-width:1180px;margin:0 auto;padding:16px 20px 28px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 20px;color:var(--muted);font-size:12.5px}
.site-footer-bottom a{color:var(--muted)}
@media (max-width:760px){.site-footer-in{grid-template-columns:1fr 1fr;gap:28px 20px}.site-footer-brand{grid-column:1/-1}}
`;
