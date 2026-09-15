/**
 * Lecture d'une date saisie au clavier, en français ou en anglais :
 * « demain », « dans 2 semaines », « in 3 days », « next month », « 15/03/2027 », « 2027-03-15 14:30 », « lundi »…
 * Renvoie null si le texte n'est pas compris.
 */

export interface ParsedDate {
  date: Date;
  /** Une heure a été précisée dans le texte */
  hasTime: boolean;
}

const UNITS: Array<[RegExp, 'day' | 'week' | 'month' | 'year']> = [
  [/^(j|jours?|d|days?)$/, 'day'],
  [/^(sem|semaines?|w|wk|weeks?)$/, 'week'],
  [/^(mois|m|mo|months?)$/, 'month'],
  [/^(ans?|années?|annees?|y|yr|years?)$/, 'year']
];

const WEEKDAYS: Record<string, number> = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
};

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12,
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function addToDate(date: Date, amount: number, unit: 'day' | 'week' | 'month' | 'year'): Date {
  const next = new Date(date);
  if (unit === 'day') next.setDate(next.getDate() + amount);
  else if (unit === 'week') next.setDate(next.getDate() + amount * 7);
  else {
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + (unit === 'month' ? amount : amount * 12));
    // 31 janvier + 1 mois : dernier jour de février plutôt que début mars
    const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, last));
  }
  return next;
}

const unitOf = (word: string) => UNITS.find(([re]) => re.test(word))?.[1] ?? null;

function extractTime(text: string): { rest: string; hours: number; minutes: number } | null {
  const match = /(?:^|\s)(?:à\s*|a\s*|at\s*)?(\d{1,2})(?:[h:](\d{2})?|\s*(am|pm))(?=\s|$)/i.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return { rest: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim(), hours, minutes };
}

export function parseNaturalDate(input: string, now = new Date()): ParsedDate | null {
  let text = input.trim().toLowerCase().replace(/\s+/g, ' ').normalize('NFC');
  if (!text) return null;

  // Date complète ISO, avec heure éventuelle
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2}))?$/.exec(text);
  if (iso) {
    const date = new Date(+iso[1], +iso[2] - 1, +iso[3], iso[4] ? +iso[4] : 0, iso[5] ? +iso[5] : 0);
    return date.getMonth() === +iso[2] - 1 ? { date, hasTime: !!iso[4] } : null;
  }

  const time = extractTime(text);
  if (time) text = time.rest;
  const today = startOfDay(now);
  const withTime = (date: Date | null): ParsedDate | null => {
    if (!date || Number.isNaN(date.getTime())) return null;
    if (time) date.setHours(time.hours, time.minutes, 0, 0);
    return { date, hasTime: !!time };
  };

  if (!text || /^(aujourd'hui|aujourd’hui|auj|today|now|maintenant)$/.test(text)) return withTime(today);
  if (/^(demain|tomorrow|tmr)$/.test(text)) return withTime(addToDate(today, 1, 'day'));
  if (/^(après-demain|apres-demain|apres demain|après demain)$/.test(text)) return withTime(addToDate(today, 2, 'day'));
  if (/^(hier|yesterday)$/.test(text)) return withTime(addToDate(today, -1, 'day'));

  // « dans 2 jours », « in 3 weeks », « +1 mois », « 2 semaines », « il y a 3 jours », « 3 days ago »
  const signed = text.replace(/^il y a\s+/, '-');
  const relative = /^(?:(dans|in|\+)\s*)?(-?\d+|-?[a-zé]+)\s*([a-zéè]+)(?:\s+(ago))?$/.exec(signed);
  if (relative) {
    const unit = unitOf(relative[3]);
    const raw = relative[2].replace(/^-/, '');
    const amount = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (unit && amount !== undefined && amount <= 1000) {
      const sign = relative[4] || signed.startsWith('-') ? -1 : 1;
      return withTime(addToDate(today, sign * Math.abs(amount), unit));
    }
  }
  const agoFr = /^-\s*(\d+)\s*([a-zéè]+)$/.exec(text.replace(/^il y a\s+/, '-'));
  if (agoFr && unitOf(agoFr[2])) return withTime(addToDate(today, -Number(agoFr[1]), unitOf(agoFr[2])!));

  // « semaine prochaine », « next month », « l'an prochain »
  const next = /^(?:la |le |l'|l’)?(semaine|mois|an|année|annee) prochaine?$|^next (week|month|year)$/.exec(text);
  if (next) return withTime(addToDate(today, 1, unitOf(next[1] ?? next[2])!));

  // Jour de la semaine : la prochaine occurrence (jamais aujourd'hui)
  const weekday = /^(?:(?:ce |next |this )?)([a-z]+)(?: prochain)?$/.exec(text);
  if (weekday && WEEKDAYS[weekday[1]] !== undefined) {
    const diff = (WEEKDAYS[weekday[1]] - today.getDay() + 7) % 7 || 7;
    return withTime(addToDate(today, diff, 'day'));
  }

  // 15/03/2027, 15.03.27, 15/03 (année en cours, ou suivante si la date est passée)
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(text);
  if (numeric) {
    const day = +numeric[1];
    const month = +numeric[2] - 1;
    let year = numeric[3] ? +numeric[3] : today.getFullYear();
    if (year < 100) year += 2000;
    let date = new Date(year, month, day);
    if (date.getMonth() !== month || date.getDate() !== day) return null;
    if (!numeric[3] && date < today) date = new Date(year + 1, month, day);
    return withTime(date);
  }

  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toIsoDateTime = (d: Date) => `${toIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** « AAAA-MM-JJ » ou « AAAA-MM-JJTHH:MM » en date locale */
export function fromIsoValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return null;
  return new Date(+match[1], +match[2] - 1, +match[3], match[4] ? +match[4] : 0, match[5] ? +match[5] : 0);
}
