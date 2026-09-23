import { SupportedLocale, Translations, fr, en } from './translations';
import { cachedPack, isLanguageCode, type LanguagePack } from './packs';

/**
 * Langue de l'interface.
 *
 * Le français et l'anglais sont intégrés. D'autres langues peuvent être
 * ajoutées par le serveur (voir `packs.ts`) : ce sont des dictionnaires
 * « texte français → traduction ». Un texte absent du dictionnaire retombe
 * sur l'anglais, qui reste la langue de repli complète.
 */

/** Code de la langue affichée : `fr`, `en`, ou celui d'une langue ajoutée */
export type LocaleCode = string;

/** Remplace chaque texte par sa traduction, ou par l'anglais s'il n'y en a pas */
function translateTree<T>(frNode: T, enNode: T, strings: Record<string, string>): T {
  if (typeof frNode === 'string' && typeof enNode === 'string') return (strings[frNode] ?? enNode) as T;
  if (frNode && enNode && typeof frNode === 'object' && typeof enNode === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(enNode as Record<string, unknown>)) {
      out[key] = translateTree((frNode as Record<string, unknown>)[key], (enNode as Record<string, unknown>)[key], strings);
    }
    return out as T;
  }
  return enNode;
}

class I18nManager {
  private currentLocale: LocaleCode = 'fr';
  private pack: LanguagePack | null = null;
  /** `t` d'une langue ajoutée, calculé une fois par dictionnaire */
  private packTranslations: Translations | null = null;
  private listeners: Array<() => void> = [];

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('bettervault.locale');
    } catch {
      // Stockage indisponible : langue du système
    }
    if (saved === 'fr' || saved === 'en') {
      this.currentLocale = saved;
    } else if (saved && isLanguageCode(saved) && this.usePack(cachedPack(saved))) {
      // Langue ajoutée déjà connue de l'appareil : disponible dès l'ouverture, même hors ligne
      this.currentLocale = saved;
    } else {
      const browserLang = globalThis.navigator?.language?.toLowerCase() || '';
      this.currentLocale = browserLang.startsWith('fr') ? 'fr' : 'en';
    }
    if (typeof document !== 'undefined') document.documentElement.lang = this.currentLocale;
  }

  private usePack(pack: LanguagePack | null): boolean {
    this.pack = pack;
    this.packTranslations = pack ? translateTree(fr, en, pack.strings) : null;
    return !!pack;
  }

  /** Vrai quand la langue affichée est une langue ajoutée par le serveur */
  public isPackLocale(): boolean {
    return this.currentLocale !== 'fr' && this.currentLocale !== 'en';
  }

  /** Nom de la langue ajoutée en cours (« Español »), s'il y en a une */
  public packName(): string | null {
    return this.pack?.name ?? null;
  }

  /**
   * Locale de formatage (dates, nombres) : la variante régionale du système quand elle correspond
   * à la langue choisie (fr-CA, fr-BE, en-GB…), sinon fr-FR ou en-US. Une langue ajoutée donne
   * son propre code à Intl (es, pt-BR…).
   */
  public intlLocale(): string {
    const base = this.currentLocale.toLowerCase().split('-')[0];
    const candidates = [...(globalThis.navigator?.languages ?? []), globalThis.navigator?.language ?? ''];
    const match = candidates.find(tag => tag && tag.toLowerCase().split('-')[0] === base);
    for (const tag of [match, this.isPackLocale() ? this.currentLocale : null]) {
      if (!tag) continue;
      try {
        return Intl.getCanonicalLocales(tag)[0];
      } catch {
        // Étiquette invalide : on essaie la suivante
      }
    }
    return this.currentLocale === 'fr' ? 'fr-FR' : 'en-US';
  }

  /** Taille de fichier : 1,5 Mo / 1.5 MB */
  public formatBytes(bytes: number): string {
    const units = this.currentLocale === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    const digits = unit === 0 || value >= 100 ? 0 : 1;
    return `${new Intl.NumberFormat(this.intlLocale(), { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
  }

  /**
   * Langue « logique » pour le code qui choisit entre français et anglais :
   * une langue ajoutée se comporte comme l'anglais partout où elle n'a pas
   * de traduction.
   */
  public getLocale(): SupportedLocale {
    return this.currentLocale === 'fr' ? 'fr' : 'en';
  }

  /** Code réellement affiché, y compris une langue ajoutée */
  public getLocaleCode(): LocaleCode {
    return this.currentLocale;
  }

  public setLocale(locale: SupportedLocale): void {
    this.applyLocale(locale, null);
  }

  /**
   * Passe à une langue ajoutée. Le dictionnaire doit déjà être chargé : on ne
   * bascule pas l'interface vers une langue dont on n'a pas les textes.
   */
  public setPackLocale(pack: LanguagePack): void {
    this.applyLocale(pack.code, pack);
  }

  private applyLocale(code: LocaleCode, pack: LanguagePack | null): void {
    if (this.currentLocale === code && this.pack === pack) return;
    this.usePack(pack);
    this.currentLocale = code;
    try {
      localStorage.setItem('bettervault.locale', code);
    } catch {
      // Stockage indisponible : le choix vaut pour cette session
    }
    if (typeof document !== 'undefined') document.documentElement.lang = code;
    this.notify();
  }

  /** Bascule entre les deux langues intégrées (sélecteur à deux choix) */
  public toggleLocale(): SupportedLocale {
    const next = this.currentLocale === 'fr' ? 'en' : 'fr';
    this.setLocale(next);
    return next;
  }

  /**
   * Choisit le texte à afficher. En français et en anglais, c'est direct ; dans
   * une langue ajoutée, on cherche la traduction du texte français, et à défaut
   * on affiche l'anglais.
   */
  public pick(frText: string, enText: string): string {
    if (this.currentLocale === 'fr') return frText;
    if (this.currentLocale === 'en' || !this.pack) return enText;
    return this.pack.strings[frText] ?? enText;
  }

  public get t(): Translations {
    if (this.currentLocale === 'fr') return fr;
    if (this.currentLocale === 'en' || !this.packTranslations) return en;
    return this.packTranslations;
  }

  public formatDate(dateString: string | Date): string {
    if (!dateString) return '';
    try {
      const d = typeof dateString === 'string' ? new Date(dateString) : dateString;
      if (isNaN(d.getTime())) return String(dateString);
      return new Intl.DateTimeFormat(this.intlLocale(), {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(d);
    } catch {
      return String(dateString);
    }
  }

  public formatRelativeDate(dateString: string): string {
    if (!dateString) return this.t.common.noDueDate;
    const today = new Date().toISOString().slice(0, 10);
    if (dateString === today) return this.t.common.today;
    return this.formatDate(dateString);
  }

  public formatNumber(num: number): string {
    return new Intl.NumberFormat(this.intlLocale()).format(num);
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(l => l());
  }
}

export const i18n = new I18nManager();
