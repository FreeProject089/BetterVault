export type ExpiryState = 'expired' | 'today' | 'critical' | 'soon' | 'ok';

export interface ExpiryInfo {
  state: ExpiryState;
  /** Jours calendaires restants (négatif : expiré depuis) */
  days: number;
  /** Texte court pour une pastille : « Expiré », « Aujourd’hui », « 3 j », « 2 mois » */
  short: string;
  /** Phrase complète pour l'infobulle et la fiche */
  long: string;
  date: string;
}

type Tr = (fr: string, en: string) => string;

const DAY_MS = 86_400_000;
export const EXPIRY_CRITICAL_DAYS = 7;
export const EXPIRY_SOON_DAYS = 30;

const startOfDay = (timestamp: number) => {
  const d = new Date(timestamp);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export function expiryInfo(expiresAt: number | undefined, tr: Tr, locale: string, now = Date.now()): ExpiryInfo | null {
  if (!expiresAt) return null;
  const days = Math.round((startOfDay(expiresAt) - startOfDay(now)) / DAY_MS);
  const date = new Date(expiresAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const plural = (n: number, fr: string, en: string) => tr(`${n} ${fr}${n > 1 ? 's' : ''}`, `${n} ${en}${n > 1 ? 's' : ''}`);

  if (days < 0) {
    const ago = -days;
    return {
      state: 'expired',
      days,
      short: tr('Expiré', 'Expired'),
      long: tr(`Expiré depuis ${plural(ago, 'jour', 'day')} (${date})`, `Expired ${plural(ago, 'jour', 'day')} ago (${date})`),
      date
    };
  }
  if (days === 0) {
    return { state: 'today', days, short: tr('Aujourd’hui', 'Today'), long: tr(`Expire aujourd’hui (${date})`, `Expires today (${date})`), date };
  }

  const state: ExpiryState = days <= EXPIRY_CRITICAL_DAYS ? 'critical' : days <= EXPIRY_SOON_DAYS ? 'soon' : 'ok';
  const short = days < 60 ? tr(`${days} j`, `${days} d`) : days < 730 ? tr(`${Math.round(days / 30)} mois`, `${Math.round(days / 30)} mo`) : tr(`${Math.round(days / 365)} ans`, `${Math.round(days / 365)} y`);
  return {
    state,
    days,
    short,
    long: tr(`Expire dans ${plural(days, 'jour', 'day')} (${date})`, `Expires in ${plural(days, 'jour', 'day')} (${date})`),
    date
  };
}

const CLOCK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ALERT = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>';

/** Pastille compacte : couleur et texte indiquent immédiatement l'urgence */
export function renderExpiryBadge(info: ExpiryInfo | null, options: { hideOk?: boolean } = {}): string {
  if (!info || (options.hideOk && info.state === 'ok')) return '';
  const icon = info.state === 'expired' || info.state === 'today' ? ALERT : CLOCK;
  return `<span class="expiry-badge expiry-${info.state}" title="${info.long.replace(/"/g, '&quot;')}">${icon}<span>${info.short}</span></span>`;
}
