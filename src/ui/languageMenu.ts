import { i18n } from '../i18n';
import { cachedLanguages, cachedPack, fetchLanguages, fetchPack, type LanguageInfo, type ServerBase } from '../i18n/packs';
import { accountService } from '../app/services';
import { isTauri } from '../platform/tauriBridge';

/**
 * Sélecteur de langue de l'en-tête.
 *
 * Deux langues : un simple bouton qui bascule, comme avant — ouvrir une liste
 * pour deux choix serait un clic de trop. Au-delà : une liste avec recherche,
 * car on ne parcourt pas dix langues en cliquant dix fois.
 */

const BUILT_IN: LanguageInfo[] = [
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'English' }
];

/**
 * Serveur qui fournit les langues ajoutées : celui du compte synchronisé, ou
 * celui qui sert l'application web. L'application de bureau sans compte n'en
 * a pas : elle garde le français, l'anglais et les langues déjà téléchargées.
 */
export function languageServer(): ServerBase {
  // Le service de compte n'existe qu'une fois l'appareil chargé : avant, pas de compte
  const account = accountService?.getAccount();
  if (account?.mode === 'cloud' && account.serverUrl) return account.serverUrl.replace(/\/+$/, '');
  const web = globalThis.location?.protocol === 'http:' || globalThis.location?.protocol === 'https:';
  return web && !isTauri() ? '' : null;
}

export interface LanguageMenuOptions {
  onChange(message: string): void;
  onError(message: string): void;
}

export function wireLanguageMenu(button: HTMLElement, label: HTMLElement | null, options: LanguageMenuOptions): () => void {
  let available: LanguageInfo[] = [...BUILT_IN, ...cachedLanguages()];
  let menu: HTMLElement | null = null;

  const paintLabel = () => {
    if (!label) return;
    // Code court dans le bouton (FR, EN, ES, PT-BR) : le nom complet est dans la liste
    label.textContent = i18n.getLocaleCode().toUpperCase();
    button.setAttribute('aria-label', `${i18n.pick('Langue', 'Language')} : ${nameOf(i18n.getLocaleCode())}`);
    button.setAttribute('aria-haspopup', available.length > 2 ? 'listbox' : 'false');
  };

  const nameOf = (code: string) => available.find(l => l.code === code)?.name ?? code;

  // La liste à jour arrive du serveur ; on part de ce que l'appareil connaît déjà
  const refresh = () => {
    void fetchLanguages(languageServer())
      .then(list => { available = [...BUILT_IN, ...list]; paintLabel(); })
      .catch(() => { /* hors ligne : la dernière liste connue suffit */ });
  };

  const choose = async (code: string) => {
    close();
    if (code === 'fr' || code === 'en') {
      i18n.setLocale(code);
    } else {
      // On ne bascule qu'avec le dictionnaire en main : sinon l'interface passerait à moitié
      let pack = await fetchPack(languageServer(), code).catch(() => null);
      pack ??= cachedPack(code);
      if (!pack) {
        options.onError(i18n.pick('Cette langue n’est pas disponible pour l’instant.', 'This language is not available right now.'));
        return;
      }
      i18n.setPackLocale(pack);
    }
    paintLabel();
    options.onChange(`${i18n.pick('Langue', 'Language')} : ${nameOf(code)}`);
  };

  const close = () => {
    menu?.remove();
    menu = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
  };

  const onOutside = (event: Event) => {
    if (menu && !menu.contains(event.target as Node) && !button.contains(event.target as Node)) close();
  };

  const open = () => {
    menu = document.createElement('div');
    menu.className = 'lang-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', i18n.pick('Choisir la langue', 'Choose the language'));
    const current = i18n.getLocaleCode();
    // Les noms viennent du serveur mais sont posés en texte : jamais d'innerHTML ici
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'form-input lang-menu-search';
    search.placeholder = i18n.pick('Chercher une langue', 'Search a language');
    search.setAttribute('aria-label', search.placeholder);
    search.autocomplete = 'off';
    search.spellcheck = false;
    const list = document.createElement('ul');
    list.className = 'lang-menu-list';
    list.setAttribute('role', 'listbox');
    const empty = document.createElement('p');
    empty.className = 'lang-menu-empty';
    empty.textContent = i18n.pick('Aucune langue ne correspond.', 'No language matches.');
    empty.hidden = true;

    const render = () => {
      const query = search.value.trim().toLowerCase();
      const matches = available.filter(l => !query || l.name.toLowerCase().includes(query) || l.code.toLowerCase().startsWith(query));
      list.replaceChildren(...matches.map((lang, index) => {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(lang.code === current));
        item.dataset.code = lang.code;
        item.tabIndex = -1;
        item.className = `lang-menu-item${lang.code === current ? ' current' : ''}${index === 0 && query ? ' first' : ''}`;
        const nom = document.createElement('span');
        nom.textContent = lang.name;
        const code = document.createElement('span');
        code.className = 'lang-menu-code';
        code.textContent = lang.code.toUpperCase();
        item.append(nom, code);
        item.addEventListener('click', () => void choose(lang.code));
        return item;
      }));
      empty.hidden = matches.length > 0;
    };

    search.addEventListener('input', render);
    // Clavier : Entrée choisit la première langue trouvée, flèches pour parcourir, Échap ferme
    menu.addEventListener('keydown', event => {
      const items = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'Escape') { event.preventDefault(); close(); button.focus(); }
      else if (event.key === 'Enter' && document.activeElement === search && items[0]) { event.preventDefault(); void choose(items[0].dataset.code!); }
      else if (event.key === 'Enter' && index >= 0) { event.preventDefault(); void choose(items[index].dataset.code!); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); items[Math.min(index + 1, items.length - 1)]?.focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); if (index <= 0) search.focus(); else items[index - 1].focus(); }
    });

    menu.append(search, list, empty);
    render();
    document.body.append(menu);
    // Placé sous le bouton, sans sortir de l'écran
    const r = button.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))}px`;
    const below = r.bottom + 6;
    if (below + 320 > window.innerHeight && r.top > 320) menu.style.bottom = `${window.innerHeight - r.top + 6}px`;
    else menu.style.top = `${below}px`;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    search.focus();
  };

  button.addEventListener('click', () => {
    if (menu) { close(); return; }
    // Deux langues : on bascule directement, sans liste
    if (available.length <= 2) {
      const next = i18n.getLocaleCode() === 'fr' ? 'en' : 'fr';
      void choose(next);
      return;
    }
    open();
  });

  paintLabel();
  refresh();
  return refresh;
}
