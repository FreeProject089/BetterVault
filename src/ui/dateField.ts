import { addToDate, fromIsoValue, parseNaturalDate, toIsoDate, toIsoDateTime } from './naturalDate';

export interface DateFieldHandle {
  /** « AAAA-MM-JJ » (ou « AAAA-MM-JJTHH:MM » avec l'heure), chaîne vide sinon */
  getValue(): string;
  setValue(value: string): void;
}

type Tr = (fr: string, en: string) => string;

const CALENDAR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
const CLOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const CLEAR = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const CHEVRON = (dir: 'left' | 'right') => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'}"/></svg>`;

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

let openField: (() => void) | null = null;

/**
 * Sélecteur de date : bouton qui ouvre un calendrier, saisie libre (« dans 2 semaines », « demain 9h »)
 * et heure en segments facultative.
 */
export function mountDateField(host: HTMLElement, options: {
  value?: string;
  label: string;
  tr: Tr;
  locale: string;
  withTime?: boolean;
  placeholder?: string;
  /** Texte du délai : « Dans 42 jours » par défaut */
  describe?: (days: number, formatted: string) => string;
  onChange?: (value: string) => void;
}): DateFieldHandle {
  const { tr, locale } = options;
  const withTime = !!options.withTime;
  let selected: Date | null = options.value ? fromIsoValue(options.value) : null;
  let view = startOfMonth(selected ?? new Date());
  const id = `df-${Math.random().toString(36).slice(2, 9)}`;

  host.classList.add('date-field');
  host.innerHTML = `
    <div class="date-field-control">
      <button type="button" class="form-input date-trigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id}">
        <span class="date-trigger-icon">${CALENDAR}</span>
        <span class="date-trigger-text"></span>
      </button>
      <button type="button" class="icon-btn date-field-clear" hidden aria-label="${tr('Effacer la date', 'Clear date')}">${CLEAR}</button>
    </div>
    <div class="date-popover" id="${id}" role="dialog" aria-label="${options.label}" hidden>
      <input type="text" class="form-input date-natural" spellcheck="false" autocomplete="off" placeholder="${tr('Ex. dans 2 semaines, demain 9h, 15/03', 'e.g. in 2 weeks, tomorrow 9am, 03/15')}">
      <div class="date-natural-preview" aria-live="polite"></div>
      <div class="cal-head">
        <button type="button" class="icon-btn cal-nav" data-nav="-1" aria-label="${tr('Mois précédent', 'Previous month')}">${CHEVRON('left')}</button>
        <div class="cal-title"></div>
        <button type="button" class="icon-btn cal-nav" data-nav="1" aria-label="${tr('Mois suivant', 'Next month')}">${CHEVRON('right')}</button>
      </div>
      <div class="cal-grid" role="grid"></div>
      ${withTime ? `
        <div class="time-row">
          <span class="time-label">${CLOCK}${tr('Heure', 'Time')}</span>
          <div class="time-segments">
            <input class="time-seg" data-seg="h" inputmode="numeric" maxlength="2" aria-label="${tr('Heures', 'Hours')}" placeholder="--">
            <span>:</span>
            <input class="time-seg" data-seg="m" inputmode="numeric" maxlength="2" aria-label="${tr('Minutes', 'Minutes')}" placeholder="--">
          </div>
        </div>` : ''}
      <div class="cal-foot">
        <button type="button" class="btn-link" data-act="today">${tr('Aujourd’hui', 'Today')}</button>
        <button type="button" class="btn-link" data-act="clear">${tr('Effacer', 'Clear')}</button>
      </div>
    </div>
    <div class="date-field-hint" aria-live="polite"></div>`;

  const trigger = host.querySelector('.date-trigger') as HTMLButtonElement;
  const triggerText = host.querySelector('.date-trigger-text') as HTMLElement;
  const clear = host.querySelector('.date-field-clear') as HTMLButtonElement;
  const popover = host.querySelector('.date-popover') as HTMLElement;
  const natural = host.querySelector('.date-natural') as HTMLInputElement;
  const preview = host.querySelector('.date-natural-preview') as HTMLElement;
  const title = host.querySelector('.cal-title') as HTMLElement;
  const grid = host.querySelector('.cal-grid') as HTMLElement;
  const hint = host.querySelector('.date-field-hint') as HTMLElement;
  const hoursInput = host.querySelector<HTMLInputElement>('[data-seg="h"]');
  const minutesInput = host.querySelector<HTMLInputElement>('[data-seg="m"]');
  trigger.setAttribute('aria-label', options.label);

  const describe = options.describe ?? ((days, formatted) => days < 0
    ? tr(`Déjà passée (${formatted})`, `Already past (${formatted})`)
    : days === 0 ? tr('Aujourd’hui', 'Today') : tr(`Dans ${days} jour${days > 1 ? 's' : ''}`, `In ${days} day${days > 1 ? 's' : ''}`));

  const format = (date: Date, time = withTime) => date.toLocaleString(locale, {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {})
  });
  const value = () => (selected ? (withTime ? toIsoDateTime(selected) : toIsoDate(selected)) : '');

  // Lundi en premier sauf pour les langues où la semaine commence le dimanche
  const firstDay = /^en-US|^en-CA|^ja|^pt-BR/.test(locale) ? 0 : 1;

  const renderGrid = () => {
    title.textContent = view.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((i + firstDay) % 7)).toLocaleDateString(locale, { weekday: 'narrow' }));
    const offset = (view.getDay() - firstDay + 7) % 7;
    const start = addToDate(view, -offset, 'day');
    const today = new Date();
    const cells = Array.from({ length: 42 }, (_, i) => {
      const day = addToDate(start, i, 'day');
      const classes = ['cal-day'];
      if (day.getMonth() !== view.getMonth()) classes.push('outside');
      if (sameDay(day, today)) classes.push('today');
      if (selected && sameDay(day, selected)) classes.push('selected');
      return `<button type="button" role="gridcell" class="${classes.join(' ')}" data-day="${toIsoDate(day)}" tabindex="${selected && sameDay(day, selected) || (!selected && sameDay(day, today)) ? '0' : '-1'}" aria-label="${day.toLocaleDateString(locale, { dateStyle: 'full' })}">${day.getDate()}</button>`;
    });
    grid.innerHTML = names.map(n => `<span class="cal-weekday">${n}</span>`).join('') + cells.join('');
  };

  const update = (notify = true) => {
    const has = !!selected;
    host.classList.toggle('has-value', has);
    clear.hidden = !has;
    triggerText.textContent = has ? format(selected!) : (options.placeholder ?? tr('Choisir une date', 'Pick a date'));
    if (hoursInput && minutesInput) {
      hoursInput.value = has ? String(selected!.getHours()).padStart(2, '0') : '';
      minutesInput.value = has ? String(selected!.getMinutes()).padStart(2, '0') : '';
    }
    if (has) {
      const target = new Date(selected!.getFullYear(), selected!.getMonth(), selected!.getDate());
      const now = new Date();
      const days = Math.round((target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
      hint.textContent = describe(days, target.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }));
      hint.className = `date-field-hint ${days < 0 ? 'past' : days <= 7 ? 'near' : ''}`;
    } else {
      hint.textContent = '';
      hint.className = 'date-field-hint';
    }
    renderGrid();
    if (notify) options.onChange?.(value());
  };

  const choose = (date: Date | null, keepTime = true) => {
    if (date && selected && keepTime && withTime) date.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    else if (date && withTime && keepTime && !selected) date.setHours(9, 0, 0, 0);
    selected = date;
    if (date) view = startOfMonth(date);
    update();
  };

  // Le calendrier est rattaché au document pendant qu'il est ouvert : les fenêtres à défilement ne le coupent pas
  let frame = 0;
  const place = () => {
    if (!host.isConnected) {
      close();
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const height = popover.offsetHeight;
    const width = popover.offsetWidth;
    const below = window.innerHeight - rect.bottom - 8;
    const top = below >= height || rect.top < height + 8 ? rect.bottom + 6 : rect.top - height - 6;
    popover.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    frame = requestAnimationFrame(place);
  };
  const close = () => {
    if (popover.hidden) return;
    cancelAnimationFrame(frame);
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (host.isConnected) host.insertBefore(popover, hint);
    else popover.remove();
    if (openField === close) openField = null;
  };
  const outside = (e: Event) => {
    const target = e.target as Node;
    if (!host.contains(target) && !popover.contains(target)) close();
  };
  const open = () => {
    openField?.();
    openField = close;
    view = startOfMonth(selected ?? new Date());
    renderGrid();
    natural.value = '';
    preview.textContent = '';
    document.body.appendChild(popover);
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    place();
    natural.focus();
  };

  trigger.addEventListener('click', () => (popover.hidden ? open() : close()));
  clear.addEventListener('click', () => {
    choose(null);
    trigger.focus();
  });

  natural.addEventListener('input', () => {
    const parsed = parseNaturalDate(natural.value);
    preview.classList.toggle('invalid', !parsed && !!natural.value.trim());
    preview.textContent = !natural.value.trim() ? '' : parsed ? format(parsed.date, withTime && parsed.hasTime) : tr('Date non reconnue', 'Date not recognised');
    if (parsed) {
      view = startOfMonth(parsed.date);
      renderGrid();
    }
  });
  natural.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const parsed = parseNaturalDate(natural.value);
      if (!parsed) return;
      choose(parsed.date, !parsed.hasTime);
      close();
      trigger.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      grid.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
    }
  });

  popover.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      trigger.focus();
    }
  });

  host.querySelectorAll<HTMLButtonElement>('.cal-nav').forEach(button => button.addEventListener('click', () => {
    view = addToDate(view, Number(button.dataset.nav), 'month');
    renderGrid();
  }));

  grid.addEventListener('click', e => {
    const day = (e.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day;
    if (!day) return;
    choose(fromIsoValue(day));
    if (!withTime) {
      close();
      trigger.focus();
    }
  });
  grid.addEventListener('keydown', e => {
    const current = (e.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day;
    if (!current) return;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in steps)) return;
    e.preventDefault();
    const target = addToDate(fromIsoValue(current)!, steps[e.key], 'day');
    if (target.getMonth() !== view.getMonth()) {
      view = startOfMonth(target);
      renderGrid();
    }
    grid.querySelectorAll<HTMLElement>('[data-day]').forEach(el => { el.tabIndex = -1; });
    const el = grid.querySelector<HTMLButtonElement>(`[data-day="${toIsoDate(target)}"]`);
    if (el) {
      el.tabIndex = 0;
      el.focus();
    }
  });

  host.querySelector('[data-act="today"]')?.addEventListener('click', () => choose(new Date(new Date().setHours(0, 0, 0, 0))));
  host.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
    choose(null);
    close();
    trigger.focus();
  });

  // Heure en segments : chiffres uniquement, bornés, passage automatique aux minutes
  const commitTime = () => {
    if (!hoursInput || !minutesInput) return;
    const h = Math.min(23, Math.max(0, parseInt(hoursInput.value, 10) || 0));
    const m = Math.min(59, Math.max(0, parseInt(minutesInput.value, 10) || 0));
    const base = selected ? new Date(selected) : new Date(new Date().setHours(0, 0, 0, 0));
    base.setHours(h, m, 0, 0);
    selected = base;
    update();
  };
  [hoursInput, minutesInput].forEach(input => {
    if (!input) return;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 2);
      if (input === hoursInput && input.value.length === 2) minutesInput?.focus();
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const max = input === hoursInput ? 23 : 59;
      const next = ((parseInt(input.value, 10) || 0) + (e.key === 'ArrowUp' ? 1 : -1) + max + 1) % (max + 1);
      input.value = String(next).padStart(2, '0');
      commitTime();
      input.select();
    });
    input.addEventListener('change', commitTime);
    input.addEventListener('focus', () => input.select());
  });

  update(false);
  return {
    getValue: value,
    setValue: next => {
      selected = next ? fromIsoValue(next) : null;
      if (selected) view = startOfMonth(selected);
      update(false);
    }
  };
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
