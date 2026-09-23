import { accountService } from '../app/services';

/**
 * Lien « En savoir plus » vers la documentation du serveur connecté.
 *
 * La documentation est servie par le serveur (`/docs`) : elle suit donc la
 * version qui tourne réellement. Sans compte synchronisé, il n'y a pas de
 * serveur à interroger et le lien est simplement absent — mieux vaut pas de
 * lien qu'un lien mort.
 */

const PAGE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)?$/;

export function docsUrl(page: string): string | null {
  if (!PAGE.test(page)) return null;
  const serveur = accountService.getAccount()?.serverUrl;
  if (serveur) return `${serveur.replace(/\/+$/, '')}/docs/${page}`;
  /*
   * Application servie par un serveur BetterVault : le chemin relatif suffit.
   * La webview de bureau sert aussi du http (tauri.localhost) mais n'embarque
   * pas la documentation : sans compte synchronisé, on n'affiche pas de lien.
   */
  const hote = globalThis.location?.hostname ?? '';
  const surServeur = globalThis.location?.protocol?.startsWith('http') && !hote.endsWith('tauri.localhost') && !('__TAURI__' in globalThis);
  return surServeur ? `/docs/${page}` : null;
}

/** Lien prêt à insérer, ou chaîne vide s'il n'y a pas de documentation joignable */
export function learnMore(page: string, tr: (fr: string, en: string) => string): string {
  const url = docsUrl(page);
  return url
    ? ` <a class="doc-link" href="${url}" target="_blank" rel="noopener noreferrer">${tr('En savoir plus', 'Learn more')}</a>`
    : '';
}

/** Même lien, seul sur sa ligne sous un titre de section ; rien s'il n'y a pas de documentation */
export function learnMoreHint(page: string, tr: (fr: string, en: string) => string): string {
  const lien = learnMore(page, tr);
  return lien ? `<p class="field-hint doc-hint">${lien.trim()}</p>` : '';
}
