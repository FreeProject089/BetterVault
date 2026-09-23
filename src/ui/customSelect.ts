/**
 * Listes déroulantes aux couleurs de l'application.
 *
 * La liste native s'ouvre dans une fenêtre dessinée par le système : blanche
 * sur fond sombre, avec la police du système, sans rapport avec le thème.
 * Sur ordinateur, chaque `<select class="form-input">` reçoit donc un bouton et
 * une liste dessinés ici. La vraie `<select>` reste en place, cachée : c'est
 * elle qui porte la valeur, les formulaires et les écouteurs `change` existants
 * n'y voient aucune différence.
 *
 * Au doigt, on garde la liste native : le sélecteur plein écran du téléphone
 * est plus confortable que tout ce qu'on pourrait dessiner.
 */

const ENHANCED = 'data-custom-select';
let openList: { close(): void } | null = null;

const isFinePointer = () => globalThis.matchMedia?.('(pointer: fine)').matches ?? true;

function enhance(select: HTMLSelectElement): void {
  // Vérifié à chaque liste : un appareil hybride passe de la souris au tactile
  if (!isFinePointer() || select.hasAttribute(ENHANCED) || select.multiple || select.size > 1) return;
  select.setAttribute(ENHANCED, '');

  const wrap = document.createElement('div');
  wrap.className = 'cselect';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${select.className} cselect-button`;
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'cselect-label';
  button.append(label);
  // Le nom accessible de la liste d'origine passe au bouton
  const aria = select.getAttribute('aria-label');
  if (aria) button.setAttribute('aria-label', aria);
  if (select.id) {
    const lbl = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(select.id)}"]`);
    if (lbl) {
      lbl.addEventListener('click', event => { event.preventDefault(); button.focus(); });
      if (!aria) button.setAttribute('aria-label', lbl.textContent?.trim() ?? '');
    }
  }

  /*
   * L'enveloppe prend la place exacte de la liste dans sa rangée : même part
   * de flex, même alignement. Sans cela, dans une rangée flex, le bouton ne
   * faisait que la largeur de son texte (« Nord ▾ ») au lieu de toute la ligne.
   */
  const place = getComputedStyle(select);
  wrap.style.flex = place.flex;
  wrap.style.alignSelf = place.alignSelf;
  if (place.width.endsWith('px') && select.style.width) wrap.style.width = select.style.width;

  select.parentNode!.insertBefore(wrap, select);
  wrap.append(select, button);
  select.classList.add('cselect-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const visible = () => [...select.options].filter(o => !o.hidden);
  const paint = () => {
    const current = select.options[select.selectedIndex];
    label.textContent = current?.textContent ?? '';
    button.disabled = select.disabled;
  };

  const pick = (option: HTMLOptionElement) => {
    if (option.disabled) return;
    if (select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    paint();
  };

  let list: HTMLUListElement | null = null;
  let active = 0;

  const close = () => {
    list?.remove();
    list = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (openList === handle) openList = null;
  };
  const handle = { close };
  const outside = (event: Event) => {
    if (list && !list.contains(event.target as Node) && !button.contains(event.target as Node)) close();
  };

  const highlight = (index: number) => {
    if (!list) return;
    const items = [...list.children] as HTMLElement[];
    active = Math.max(0, Math.min(index, items.length - 1));
    items.forEach((item, i) => item.classList.toggle('active', i === active));
    items[active]?.scrollIntoView({ block: 'nearest' });
    if (items[active]) button.setAttribute('aria-activedescendant', items[active].id);
  };

  const open = () => {
    openList?.close();
    paint();
    const options = visible();
    list = document.createElement('ul');
    list.className = 'cselect-list';
    list.setAttribute('role', 'listbox');
    list.id = `cselect-${Math.random().toString(36).slice(2, 9)}`;
    button.setAttribute('aria-controls', list.id);
    // Texte posé par textContent : une option ne peut rien injecter
    options.forEach((option, index) => {
      const item = document.createElement('li');
      item.id = `${list!.id}-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.className = `cselect-option${option.selected ? ' selected' : ''}${option.disabled ? ' disabled' : ''}`;
      item.textContent = option.textContent;
      item.addEventListener('pointerdown', event => event.preventDefault());
      item.addEventListener('click', () => { pick(option); close(); button.focus(); });
      item.addEventListener('pointermove', () => highlight(index));
      list!.append(item);
    });
    document.body.append(list);
    // Sous le bouton, ou au-dessus s'il n'y a pas la place ; même largeur
    const r = button.getBoundingClientRect();
    list.style.minWidth = `${r.width}px`;
    list.style.left = `${Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 160) - 8))}px`;
    const room = innerHeight - r.bottom;
    if (room < 240 && r.top > room) {
      list.style.bottom = `${innerHeight - r.top + 4}px`;
      list.style.maxHeight = `${Math.min(320, r.top - 12)}px`;
    } else {
      list.style.top = `${r.bottom + 4}px`;
      list.style.maxHeight = `${Math.min(320, room - 12)}px`;
    }
    button.setAttribute('aria-expanded', 'true');
    openList = handle;
    highlight(Math.max(0, options.findIndex(o => o.selected)));
    document.addEventListener('pointerdown', outside, true);
  };

  let typed = '';
  let typedAt = 0;
  button.addEventListener('click', () => (list ? close() : open()));
  button.addEventListener('keydown', event => {
    const options = visible();
    if (!list && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(); return; }
    if (!list) return;
    if (event.key === 'Escape' || event.key === 'Tab') { close(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); highlight(active + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); highlight(active - 1); }
    else if (event.key === 'Home') { event.preventDefault(); highlight(0); }
    else if (event.key === 'End') { event.preventDefault(); highlight(options.length - 1); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (options[active]) pick(options[active]); close(); }
    else if (event.key.length === 1) {
      // Taper les premières lettres va à l'option correspondante, comme la liste native
      typed = Date.now() - typedAt > 700 ? event.key.toLowerCase() : typed + event.key.toLowerCase();
      typedAt = Date.now();
      const found = options.findIndex(o => (o.textContent ?? '').trim().toLowerCase().startsWith(typed));
      if (found >= 0) highlight(found);
    }
  });

  // La valeur peut changer par le code : on se recale à chaque occasion
  select.addEventListener('change', paint);
  new MutationObserver(paint).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  paint();
}

/** Améliore les listes présentes, puis celles qui apparaîtront (fenêtres, formulaires) */
let observing = false;

export function initCustomSelects(root: ParentNode = document): void {
  const run = (scope: ParentNode) => scope.querySelectorAll<HTMLSelectElement>(`select.form-input:not([${ENHANCED}])`).forEach(enhance);
  run(root);
  // Un seul observateur, même si l'initialisation est rappelée
  if (observing) return;
  observing = true;
  new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (node instanceof HTMLSelectElement && node.classList.contains('form-input')) enhance(node);
        else if (node instanceof Element) run(node);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
  // Défilement ou redimensionnement : une liste ouverte se referme plutôt que de flotter ailleurs
  addEventListener('resize', () => openList?.close());
  addEventListener('scroll', event => {
    if (!(event.target as Element)?.closest?.('.cselect-list')) openList?.close();
  }, true);
}
