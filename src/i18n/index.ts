import { SupportedLocale, Translations, fr, en } from './translations';

class I18nManager {
  private currentLocale: SupportedLocale = 'fr';
  private listeners: Array<() => void> = [];

  constructor() {
    const saved = localStorage.getItem('bettervault.locale') as SupportedLocale | null;
    if (saved === 'fr' || saved === 'en') {
      this.currentLocale = saved;
    } else {
      const browserLang = navigator.language?.toLowerCase() || '';
      this.currentLocale = browserLang.startsWith('fr') ? 'fr' : 'en';
    }
    if (typeof document !== 'undefined') document.documentElement.lang = this.currentLocale;
  }

  /**
   * Locale de formatage (dates, nombres) : la variante régionale du système quand elle correspond
   * à la langue choisie (fr-CA, fr-BE, en-GB…), sinon fr-FR ou en-US.
   */
  public intlLocale(): string {
    const candidates = [...(globalThis.navigator?.languages ?? []), globalThis.navigator?.language ?? ''];
    const match = candidates.find(tag => tag && tag.toLowerCase().split('-')[0] === this.currentLocale);
    if (match) {
      try {
        return Intl.getCanonicalLocales(match)[0];
      } catch {
        // Étiquette invalide : valeur par défaut
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

  public getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  public setLocale(locale: SupportedLocale): void {
    if (this.currentLocale === locale) return;
    this.currentLocale = locale;
    localStorage.setItem('bettervault.locale', locale);
    document.documentElement.lang = locale;
    this.notify();
  }

  public toggleLocale(): SupportedLocale {
    const next = this.currentLocale === 'fr' ? 'en' : 'fr';
    this.setLocale(next);
    return next;
  }

  public get t(): Translations {
    return this.currentLocale === 'fr' ? fr : en;
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
