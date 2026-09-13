import { SupportedLocale, Translations, fr, en } from './translations';

class I18nManager {
  private currentLocale: SupportedLocale = 'fr';
  private listeners: Array<() => void> = [];

  constructor() {
    const saved = localStorage.getItem('bum_locale') as SupportedLocale | null;
    if (saved === 'fr' || saved === 'en') {
      this.currentLocale = saved;
    } else {
      const browserLang = navigator.language?.toLowerCase() || '';
      this.currentLocale = browserLang.startsWith('fr') ? 'fr' : 'en';
    }
  }

  public getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  public setLocale(locale: SupportedLocale): void {
    if (this.currentLocale === locale) return;
    this.currentLocale = locale;
    localStorage.setItem('bum_locale', locale);
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
      return new Intl.DateTimeFormat(this.currentLocale === 'fr' ? 'fr-FR' : 'en-US', {
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
    return new Intl.NumberFormat(this.currentLocale === 'fr' ? 'fr-FR' : 'en-US').format(num);
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
