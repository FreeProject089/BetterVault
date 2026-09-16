import { ICON_SET_LABELS, loadIconSet, renderItemIcon, searchIcons, type IconEntry, type IconSet, type ItemIcon } from '../icons/iconLibrary';

type Tr = (fr: string, en: string) => string;

const SETS: IconSet[] = ['simple', 'lucide', 'phosphor'];
const RESULT_LIMIT = 160;

/**
 * Sélecteur d'icône intégré (panneau dans la modale) : logos de marques, icônes Lucide ou Phosphor.
 * onPick(undefined) retire l'icône : l'élément reprend l'icône détectée depuis son site.
 */
export function mountIconPicker(host: HTMLElement, options: {
  tr: Tr;
  current?: ItemIcon;
  /** Recherche proposée à l'ouverture (nom du service, domaine) */
  initialQuery?: string;
  initialSet?: IconSet;
  allowAutomatic?: boolean;
  onPick: (icon: ItemIcon | undefined) => void;
}): { focus(): void } {
  const { tr } = options;
  let activeSet: IconSet = options.current?.set ?? options.initialSet ?? 'simple';
  let results: IconEntry[] = [];
  let requestId = 0;
  let mono = !!options.current?.mono;

  host.classList.add('icon-picker');
  host.innerHTML = `
    <div class="icon-picker-top">
      <div class="tab-btn-group icon-picker-tabs" role="tablist">
        ${SETS.map(set => `<button type="button" class="tab-btn" role="tab" data-set="${set}">${ICON_SET_LABELS[set]}</button>`).join('')}
      </div>
      <div class="search-box icon-picker-search">
        <span class="search-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></span>
        <input type="search" class="search-input" autocomplete="off" spellcheck="false">
      </div>
    </div>
    <div class="icon-picker-grid" role="listbox"></div>
    <div class="icon-picker-footer">
      <label class="check-row icon-picker-mono" hidden><input type="checkbox" data-mono> ${tr('Logos en monochrome', 'Monochrome logos')}</label>
      <span class="icon-picker-status" aria-live="polite"></span>
      ${options.allowAutomatic !== false ? `<button type="button" class="btn-primary btn-ghost icon-picker-auto">${tr('Icône automatique', 'Automatic icon')}</button>` : ''}
    </div>`;

  const search = host.querySelector('.icon-picker-search input') as HTMLInputElement;
  const grid = host.querySelector('.icon-picker-grid') as HTMLElement;
  const status = host.querySelector('.icon-picker-status') as HTMLElement;
  search.placeholder = tr('Rechercher une icône', 'Search icons');
  search.value = options.initialQuery ?? '';
  grid.setAttribute('aria-label', tr('Icônes', 'Icons'));

  const monoRow = host.querySelector('.icon-picker-mono') as HTMLElement;
  const monoBox = host.querySelector('[data-mono]') as HTMLInputElement;
  monoBox.checked = mono;

  const renderTabs = () => {
    host.querySelectorAll<HTMLElement>('[data-set]').forEach(tab => {
      const active = tab.dataset.set === activeSet;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    // Le choix couleur officielle / monochrome ne concerne que les logos de marques
    monoRow.hidden = activeSet !== 'simple';
  };

  monoBox.addEventListener('change', () => {
    mono = monoBox.checked;
    void renderGrid();
  });

  const renderGrid = async () => {
    const id = ++requestId;
    renderTabs();
    grid.innerHTML = '<div class="icon-picker-loading"></div>';
    status.textContent = tr('Chargement…', 'Loading…');
    let entries: IconEntry[];
    try {
      entries = await loadIconSet(activeSet);
    } catch {
      if (id !== requestId) return;
      grid.innerHTML = '';
      status.textContent = tr('Impossible de charger les icônes', 'Could not load icons');
      return;
    }
    if (id !== requestId) return;

    const query = search.value;
    results = searchIcons(entries, query, RESULT_LIMIT);
    // Sans correspondance exacte pour la suggestion initiale, on montre la bibliothèque plutôt qu'une grille vide
    if (results.length === 0 && query === options.initialQuery) results = entries.slice(0, RESULT_LIMIT);

    grid.innerHTML = results.map((entry, index) => {
      const selected = options.current?.set === entry.set && options.current.name === entry.name;
      const label = (entry.title ?? entry.name).replace(/"/g, '&quot;');
      return `<button type="button" class="icon-picker-item ${selected ? 'selected' : ''}" role="option" aria-selected="${selected}" data-index="${index}" title="${label}" aria-label="${label}">${renderItemIcon({ ...entry, mono }, 22)}</button>`;
    }).join('');

    const total = query.trim() ? searchIcons(entries, query, Infinity).length : entries.length;
    status.textContent = results.length === 0
      ? tr('Aucune icône trouvée', 'No icons found')
      : total > results.length
        ? tr(`${results.length} sur ${total} — affinez la recherche`, `${results.length} of ${total} — refine your search`)
        : tr(`${total} icône${total > 1 ? 's' : ''}`, `${total} icon${total > 1 ? 's' : ''}`);
  };

  let searchTimer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void renderGrid(), 120);
  });
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      (grid.querySelector('.icon-picker-item') as HTMLElement | null)?.click();
    }
  });

  host.querySelector('.icon-picker-tabs')?.addEventListener('click', e => {
    const set = (e.target as HTMLElement).closest<HTMLElement>('[data-set]')?.dataset.set as IconSet | undefined;
    if (!set || set === activeSet) return;
    activeSet = set;
    void renderGrid();
  });

  grid.addEventListener('click', e => {
    const index = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')?.dataset.index;
    const entry = index === undefined ? undefined : results[Number(index)];
    if (!entry) return;
    options.onPick({ set: entry.set, name: entry.name, title: entry.title, hex: entry.hex, body: entry.body, ...(mono && entry.set === 'simple' ? { mono: true } : {}) });
  });

  host.querySelector('.icon-picker-auto')?.addEventListener('click', () => options.onPick(undefined));

  void renderGrid();
  return { focus: () => search.focus() };
}
