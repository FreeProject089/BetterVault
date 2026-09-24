import { GEN_ICONS } from '../ui/icons';
import { learnMore } from './docsLink';
import { bindingFromEvent, checkBinding, DEFAULT_SHORTCUTS, formatBinding, saveShortcuts, SHORTCUT_ORDER, type ShortcutAction } from '../ui/shortcuts';
import type { AppController } from '../main';

/** Raccourcis clavier, personnalisables */
export function openShortcutsModal(app: AppController): void {
  const tr = (fr: string, en: string) => app.tr(fr, en);
  const labels: Record<ShortcutAction, string> = {
    search: tr('Rechercher', 'Search'),
    newItem: tr('Nouvel identifiant ou nouvelle tâche', 'New credential or task'),
    generator: tr('Générateur de mots de passe', 'Password generator'),
    lock: tr('Verrouiller le coffre', 'Lock the vault'),
    sync: tr('Synchroniser maintenant', 'Sync now'),
    viewCredentials: tr('Afficher les identifiants', 'Show credentials'),
    view2fa: tr('Afficher les codes 2FA', 'Show 2FA codes'),
    viewTasks: tr('Afficher les tâches', 'Show tasks'),
    importExport: tr('Importer / exporter', 'Import / export'),
    account: tr('Compte et réglages', 'Account and settings'),
    help: tr('Afficher les raccourcis', 'Show shortcuts')
  };
  let recording: ShortcutAction | null = null;
  // Les changements restent un brouillon jusqu'à « Enregistrer »
  let draft = { ...app.shortcuts };
  const dirty = () => SHORTCUT_ORDER.some(a => draft[a] !== app.shortcuts[a]);

  const box = app.openModal(`
    <div class="modal-header">
      <div class="modal-title">${tr('Raccourcis clavier', 'Keyboard shortcuts')}</div>
      <button class="modal-close">${GEN_ICONS.close}</button>
    </div>
    <div class="modal-body">
      <p class="modal-text">${tr('Cliquez sur une combinaison puis appuyez sur les touches voulues. Échap annule, Retour arrière retire le raccourci.', 'Click a combination, then press the keys you want. Esc cancels, Backspace removes the shortcut.')}${learnMore('guide/shortcuts', tr)}</p>
      <div class="shortcut-list" data-shortcut-list></div>
      <div class="shortcut-row fixed">
        <span>${tr('Fermer la fenêtre ouverte', 'Close the open window')}</span>
        <kbd class="shortcut-key">Esc</kbd>
      </div>
      <div class="form-error" data-shortcut-error role="alert" hidden></div>
    </div>
    <div class="modal-footer shortcut-footer">
      <button type="button" class="btn-primary btn-ghost shortcut-btn" data-shortcut-reset-all>${tr('Valeurs par défaut', 'Reset to defaults')}</button>
      <span class="shortcut-status" data-shortcut-status role="status" aria-live="polite"></span>
      <button type="button" class="btn-primary btn-ghost shortcut-btn" data-close>${tr('Fermer', 'Close')}</button>
      <button type="button" class="btn-primary shortcut-btn" data-shortcut-save disabled>${tr('Enregistrer', 'Save')}</button>
    </div>
  `);

  const list = box.querySelector('[data-shortcut-list]') as HTMLElement;
  const errorEl = box.querySelector('[data-shortcut-error]') as HTMLElement;
  const statusEl = box.querySelector('[data-shortcut-status]') as HTMLElement;
  const saveBtn = box.querySelector('[data-shortcut-save]') as HTMLButtonElement;
  const showError = (text: string) => {
    errorEl.textContent = text;
    errorEl.hidden = !text;
  };
  const setStatus = (text: string, tone: '' | 'pending' | 'success' = '') => {
    statusEl.textContent = text;
    statusEl.dataset.tone = tone;
  };
  const refreshFooter = () => {
    saveBtn.disabled = !dirty();
    if (dirty()) setStatus(tr('Modifications non enregistrées', 'Unsaved changes'), 'pending');
    else if (statusEl.dataset.tone === 'pending') setStatus('');
  };

  const render = () => {
    list.innerHTML = SHORTCUT_ORDER.map(action => {
      const binding = draft[action];
      const custom = binding !== DEFAULT_SHORTCUTS[action];
      return `
        <div class="shortcut-row ${custom ? 'custom' : ''}">
          <span>${labels[action]}</span>
          <span class="shortcut-actions">
            ${custom ? `<button type="button" class="icon-btn" data-shortcut-reset="${action}" title="${tr('Rétablir', 'Reset')} (${formatBinding(DEFAULT_SHORTCUTS[action])})" aria-label="${tr('Rétablir', 'Reset')}">${GEN_ICONS.refresh}</button>` : ''}
            <button type="button" class="shortcut-key ${recording === action ? 'recording' : ''}" data-shortcut="${action}" aria-label="${labels[action]} : ${formatBinding(binding)}">${recording === action ? tr('Appuyez…', 'Press keys…') : formatBinding(binding)}</button>
          </span>
        </div>`;
    }).join('');
    refreshFooter();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return stopRecording();
    if (e.key === 'Backspace' || e.key === 'Delete') {
      draft = { ...draft, [recording]: '' };
      return stopRecording();
    }
    const combo = bindingFromEvent(e);
    if (!combo) return;
    const problem = checkBinding(draft, recording, combo);
    if (problem?.kind === 'reserved') return showError(tr(`${formatBinding(combo)} est réservé par le navigateur ou le système`, `${formatBinding(combo)} is reserved by the browser or system`));
    if (problem?.kind === 'needsModifier') return showError(tr('Ajoutez Ctrl, Cmd ou Alt : une lettre seule gênerait la saisie', 'Add Ctrl, Cmd or Alt: a single letter would get in the way of typing'));
    const next = { ...draft, [recording]: combo };
    // Combinaison déjà prise : elle est retirée de l'autre action, qui est signalée
    if (problem?.kind === 'conflict') {
      next[problem.action] = '';
      showError(tr(`${formatBinding(combo)} a été retiré de « ${labels[problem.action]} »`, `${formatBinding(combo)} was removed from "${labels[problem.action]}"`));
    } else {
      showError('');
    }
    draft = next;
    stopRecording();
  };

  // Appelée depuis onKey : déclarée après, mais seulement exécutée une fois les deux définies
  const stopRecording = (): void => {
    recording = null;
    app.recordingShortcut = false;
    document.removeEventListener('keydown', onKey, true);
    render();
  };

  list.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const reset = target.closest<HTMLElement>('[data-shortcut-reset]')?.dataset.shortcutReset as ShortcutAction | undefined;
    if (reset) {
      const problem = checkBinding(draft, reset, DEFAULT_SHORTCUTS[reset]);
      const next = { ...draft, [reset]: DEFAULT_SHORTCUTS[reset] };
      if (problem?.kind === 'conflict') next[problem.action] = '';
      draft = next;
      showError('');
      render();
      return;
    }
    const action = target.closest<HTMLElement>('[data-shortcut]')?.dataset.shortcut as ShortcutAction | undefined;
    if (!action) return;
    if (recording === action) return stopRecording();
    if (!recording) document.addEventListener('keydown', onKey, true);
    recording = action;
    app.recordingShortcut = true;
    showError('');
    render();
  });

  box.querySelector('[data-shortcut-reset-all]')?.addEventListener('click', () => {
    if (recording) stopRecording();
    draft = { ...DEFAULT_SHORTCUTS };
    showError('');
    render();
    if (!dirty()) setStatus(tr('Déjà aux valeurs par défaut', 'Already at defaults'), 'success');
  });

  saveBtn.addEventListener('click', () => {
    if (recording) stopRecording();
    try {
      saveShortcuts(draft);
    } catch {
      showError(tr('Enregistrement impossible sur cet appareil', 'Could not save on this device'));
      return;
    }
    app.shortcuts = { ...draft };
    render();
    setStatus(tr('Raccourcis enregistrés', 'Shortcuts saved'), 'success');
    app.showToast(tr('Raccourcis enregistrés', 'Shortcuts saved'), 'success');
  });

  // Fermeture pendant l'enregistrement : le clavier est relâché
  new MutationObserver((_records, observer) => {
    if (box.isConnected) return;
    if (recording) stopRecording();
    observer.disconnect();
  }).observe(document.body, { childList: true, subtree: true });

  render();
}
