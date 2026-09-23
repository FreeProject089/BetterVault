// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sanitizePack, isLanguageCode } from '../src/i18n/packs';
import { i18n } from '../src/i18n';
import { wireLanguageMenu } from '../src/ui/languageMenu';

/**
 * Langues ajoutées, côté application.
 *
 * Le serveur n'est pas cru sur parole : ses traductions s'affichent là où le
 * coffre est déchiffré, alors l'application refait elle-même le tri.
 */

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

describe('Dictionnaire reçu du serveur', () => {
  it('écarte toute traduction capable de sortir du texte, même si le serveur l’a laissée passer', () => {
    const pack = sanitizePack({
      code: 'es',
      name: 'Español',
      strings: {
        'Annuler': 'Cancelar',
        'Fermer': '<img src=x onerror=alert(1)>',
        'Copier': 'Copiar" autofocus onfocus="alert(1)',
        'Aide': 'Ayuda'
      }
    });
    expect(pack!.strings).toEqual({ 'Annuler': 'Cancelar', 'Aide': 'Ayuda' });
  });

  it('refuse un code qui n’est pas une langue, ou une langue intégrée', () => {
    expect(sanitizePack({ code: '../../x', name: 'x', strings: {} })).toBeNull();
    expect(sanitizePack({ code: 'fr', name: 'x', strings: {} })).toBeNull();
    expect(isLanguageCode('pt-BR')).toBe(true);
    expect(isLanguageCode('zh-Hans')).toBe(true);
    expect(isLanguageCode('en')).toBe(false);
  });

  it('retire le balisage du nom affiché', () => {
    expect(sanitizePack({ code: 'es', name: 'Esp<b>añol</b>', strings: {} })!.name).toBe('Espbañol/b');
  });
});

describe('Langue affichée', () => {
  afterEach(() => i18n.setLocale('fr'));

  it('prend la traduction, et l’anglais pour ce qui n’est pas traduit', () => {
    i18n.setPackLocale({ code: 'es', name: 'Español', strings: { 'Annuler': 'Cancelar' } });
    expect(i18n.pick('Annuler', 'Cancel')).toBe('Cancelar');
    expect(i18n.pick('Fermer', 'Close')).toBe('Close');
    expect(i18n.getLocaleCode()).toBe('es');
    // Le code qui choisit entre français et anglais voit de l'anglais : c'est le repli
    expect(i18n.getLocale()).toBe('en');
  });

  it('traduit aussi les textes à clés, avec le même repli', () => {
    const francais = i18n.t.common.today;
    i18n.setLocale('en');
    const anglais = i18n.t.common.today;
    i18n.setPackLocale({ code: 'es', name: 'Español', strings: { [francais]: 'Hoy' } });
    expect(i18n.t.common.today).toBe('Hoy');
    // Une clé sans traduction garde l'anglais, jamais une valeur vide
    const autre = Object.values(i18n.t.common).find(v => v !== 'Hoy');
    expect(typeof autre).toBe('string');
    expect(anglais).not.toBe(francais);
  });

  it('revient au français et à l’anglais sans garder la langue ajoutée', () => {
    i18n.setPackLocale({ code: 'es', name: 'Español', strings: { 'Annuler': 'Cancelar' } });
    i18n.setLocale('fr');
    expect(i18n.pick('Annuler', 'Cancel')).toBe('Annuler');
    i18n.setLocale('en');
    expect(i18n.pick('Annuler', 'Cancel')).toBe('Cancel');
  });
});

describe('Sélecteur de langue', () => {
  let button: HTMLButtonElement;
  let label: HTMLSpanElement;

  const serverWith = (languages: Array<{ code: string; name: string }>) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('/api/v1/i18n')) return new Response(JSON.stringify({ languages }), { status: 200 });
      const code = url.split('/').pop();
      return new Response(JSON.stringify({ code, name: languages.find(l => l.code === code)?.name, strings: { 'Langue': 'Idioma' } }), { status: 200 });
    });
  };

  beforeEach(() => {
    i18n.setLocale('fr');
    try { localStorage.clear(); } catch { /* rien */ }
    document.body.innerHTML = '<button id="lang"><span id="label"></span></button>';
    button = document.getElementById('lang') as HTMLButtonElement;
    label = document.getElementById('label') as HTMLSpanElement;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelector('.lang-menu')?.remove();
    i18n.setLocale('fr');
  });

  it('avec deux langues, bascule directement sans ouvrir de liste', async () => {
    serverWith([]);
    wireLanguageMenu(button, label, { onChange: () => undefined, onError: () => undefined });
    await tick(10);
    button.click();
    await tick(10);
    expect(document.querySelector('.lang-menu')).toBeNull();
    expect(i18n.getLocaleCode()).toBe('en');
    expect(label.textContent).toBe('EN');
  });

  it('au-delà, ouvre une liste où l’on cherche, et choisit au clavier', async () => {
    serverWith([{ code: 'es', name: 'Español' }, { code: 'de', name: 'Deutsch' }]);
    wireLanguageMenu(button, label, { onChange: () => undefined, onError: () => undefined });
    await tick(10);
    button.click();
    const menu = document.querySelector('.lang-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    expect([...menu.querySelectorAll('[role="option"]')].map(o => o.firstChild!.textContent)).toEqual(['Français', 'English', 'Español', 'Deutsch']);

    const search = menu.querySelector('input') as HTMLInputElement;
    search.value = 'esp';
    search.dispatchEvent(new Event('input'));
    expect([...menu.querySelectorAll('[role="option"]')].map(o => o.firstChild!.textContent)).toEqual(['Español']);

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick(20);
    expect(i18n.getLocaleCode()).toBe('es');
    expect(i18n.pick('Langue', 'Language')).toBe('Idioma');
    expect(document.querySelector('.lang-menu')).toBeNull();
  });

  it('affiche les noms venus du serveur comme du texte', async () => {
    serverWith([{ code: 'es', name: '<img src=x onerror=alert(1)>' }, { code: 'de', name: 'Deutsch' }]);
    wireLanguageMenu(button, label, { onChange: () => undefined, onError: () => undefined });
    await tick(10);
    button.click();
    const menu = document.querySelector('.lang-menu') as HTMLElement;
    expect(menu.querySelector('img')).toBeNull();
  });

  it('dit quand une langue n’est pas joignable, sans basculer à moitié', async () => {
    serverWith([{ code: 'es', name: 'Español' }, { code: 'de', name: 'Deutsch' }]);
    const onError = vi.fn();
    wireLanguageMenu(button, label, { onChange: () => undefined, onError });
    await tick(10);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
    button.click();
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.dataset.code === 'de')!;
    option.click();
    await tick(20);
    expect(onError).toHaveBeenCalled();
    expect(i18n.getLocaleCode()).toBe('fr');
  });
});
