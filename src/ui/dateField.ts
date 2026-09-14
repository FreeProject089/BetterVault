export interface DateFieldHandle {
  /** Date au format AAAA-MM-JJ, ou chaîne vide */
  getValue(): string;
  setValue(value: string): void;
}

type Tr = (fr: string, en: string) => string;

const CALENDAR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
const CLEAR = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Date avec raccourcis (+1 mois, +3 mois…) et rappel lisible du délai */
export function mountDateField(host: HTMLElement, options: {
  value?: string;
  label: string;
  tr: Tr;
  locale: string;
  presets?: Array<{ label: string; days?: number; months?: number }>;
  /** Texte du délai : « Expire dans 42 jours » par défaut */
  describe?: (days: number, formatted: string) => string;
}): DateFieldHandle {
  const { tr } = options;
  const presets = options.presets ?? [
    { label: tr('1 mois', '1 month'), months: 1 },
    { label: tr('3 mois', '3 months'), months: 3 },
    { label: tr('6 mois', '6 months'), months: 6 },
    { label: tr('1 an', '1 year'), months: 12 }
  ];

  host.classList.add('date-field');
  host.innerHTML = `
    <div class="date-field-control">
      <span class="date-field-icon">${CALENDAR}</span>
      <input type="date" class="form-input date-field-input">
      <button type="button" class="icon-btn date-field-clear" hidden>${CLEAR}</button>
    </div>
    <div class="date-field-presets">
      ${presets.map((preset, index) => `<button type="button" class="date-chip" data-preset="${index}">+ ${preset.label}</button>`).join('')}
    </div>
    <div class="date-field-hint" aria-live="polite"></div>`;

  const input = host.querySelector('.date-field-input') as HTMLInputElement;
  const clear = host.querySelector('.date-field-clear') as HTMLButtonElement;
  const hint = host.querySelector('.date-field-hint') as HTMLElement;
  input.setAttribute('aria-label', options.label);
  clear.setAttribute('aria-label', tr('Effacer la date', 'Clear date'));

  const describe = options.describe ?? ((days, formatted) => days < 0
    ? tr(`Déjà passée (${formatted})`, `Already past (${formatted})`)
    : days === 0 ? tr('Aujourd’hui', 'Today') : tr(`Dans ${days} jour${days > 1 ? 's' : ''} · ${formatted}`, `In ${days} day${days > 1 ? 's' : ''} · ${formatted}`));

  const update = () => {
    clear.hidden = !input.value;
    host.classList.toggle('has-value', !!input.value);
    if (!input.value) {
      hint.textContent = '';
      hint.className = 'date-field-hint';
      return;
    }
    const [y, m, d] = input.value.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const today = new Date();
    const days = Math.round((target.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
    hint.textContent = describe(days, target.toLocaleDateString(options.locale, { day: 'numeric', month: 'long', year: 'numeric' }));
    hint.className = `date-field-hint ${days < 0 ? 'past' : days <= 7 ? 'near' : ''}`;
  };

  host.querySelector('.date-field-presets')?.addEventListener('click', e => {
    const index = (e.target as HTMLElement).closest<HTMLElement>('[data-preset]')?.dataset.preset;
    if (index === undefined) return;
    const preset = presets[Number(index)];
    const date = new Date();
    if (preset.months) date.setMonth(date.getMonth() + preset.months);
    if (preset.days) date.setDate(date.getDate() + preset.days);
    input.value = toIso(date);
    update();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    update();
    input.focus();
  });
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  host.querySelector('.date-field-icon')?.addEventListener('click', () => {
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  });

  input.value = options.value ?? '';
  update();
  return {
    getValue: () => input.value,
    setValue: value => {
      input.value = value;
      update();
    }
  };
}
