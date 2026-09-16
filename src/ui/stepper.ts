/**
 * Parcours en étapes : découpe un long formulaire en quelques écrans courts.
 *
 * Les panneaux restent tous dans le document, seul leur affichage change. Ce qui est
 * branché dessus (sélecteur d'icône, champ de tags, pièces jointes) continue donc de
 * fonctionner sans être remonté à chaque étape, et rien n'est perdu en revenant en arrière.
 */

type Tr = (fr: string, en: string) => string;

export interface StepDef {
  /** Correspond à un panneau `[data-step="…"]` dans le corps */
  id: string;
  label: string;
  /** Renvoie un message d'erreur pour bloquer le passage à l'étape suivante, ou rien pour laisser passer */
  validate?: () => string | undefined;
}

export interface StepperHandle {
  currentId(): string;
  /** Redéfinit les étapes (le type d'élément choisi change la suite du parcours) */
  setSteps(steps: StepDef[]): void;
  go(id: string): void;
  next(): void;
  back(): void;
  /** Ré-affiche le fil et les boutons sans changer d'étape */
  refresh(): void;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

export function mountStepper(options: {
  body: HTMLElement;
  header: HTMLElement;
  footer: HTMLElement;
  steps: StepDef[];
  tr: Tr;
  finishLabel: string;
  onFinish: () => void;
  onError?: (message: string) => void;
  onStepChange?: (id: string, index: number) => void;
  /** Bouton « Annuler » de la première étape */
  cancelLabel?: string;
  onCancel?: () => void;
}): StepperHandle {
  const { body, header, footer, tr } = options;
  let steps = options.steps;
  let index = 0;

  const panels = () => [...body.querySelectorAll<HTMLElement>('[data-step]')];

  const renderHeader = () => {
    header.className = 'stepper-track';
    header.setAttribute('role', 'list');
    header.innerHTML = steps.map((step, i) => `
      <div class="stepper-step ${i === index ? 'active' : ''} ${i < index ? 'done' : ''}" role="listitem" ${i === index ? 'aria-current="step"' : ''}>
        <span class="stepper-dot">${i < index ? '✓' : i + 1}</span>
        <span class="stepper-label">${escapeHtml(step.label)}</span>
      </div>`).join('');
  };

  const renderFooter = () => {
    const first = index === 0;
    const last = index === steps.length - 1;
    footer.innerHTML = `
      <span class="stepper-count">${tr(`Étape ${index + 1} sur ${steps.length}`, `Step ${index + 1} of ${steps.length}`)}</span>
      <div class="stepper-actions">
        <button class="btn-primary" type="button" data-step-back>${first ? escapeHtml(options.cancelLabel ?? tr('Annuler', 'Cancel')) : tr('Retour', 'Back')}</button>
        <button class="btn-primary btn-accent" type="button" data-step-next>${last ? escapeHtml(options.finishLabel) : tr('Continuer', 'Continue')}</button>
      </div>`;

    footer.querySelector<HTMLButtonElement>('[data-step-back]')?.addEventListener('click', () => {
      if (index === 0) options.onCancel?.();
      else back();
    });
    footer.querySelector<HTMLButtonElement>('[data-step-next]')?.addEventListener('click', () => next());
  };

  const show = () => {
    const currentId = steps[index]?.id;
    for (const panel of panels()) panel.hidden = panel.dataset.step !== currentId;
    renderHeader();
    renderFooter();
    options.onStepChange?.(currentId, index);
    // Le premier champ de l'étape prend le focus, sauf sur un écran de simple choix
    const panel = panels().find(p => p.dataset.step === currentId);
    const field = panel?.querySelector<HTMLElement>('[data-step-autofocus]')
      ?? panel?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, select');
    field?.focus();
  };

  const next = () => {
    const error = steps[index]?.validate?.();
    if (error) {
      options.onError?.(error);
      return;
    }
    if (index === steps.length - 1) {
      options.onFinish();
      return;
    }
    index++;
    show();
  };

  const back = () => {
    if (index === 0) return;
    index--;
    show();
  };

  // Entrée valide l'étape, sauf dans une zone de texte où elle sert à aller à la ligne
  body.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    if (target.closest('[data-step-no-enter]')) return;
    event.preventDefault();
    next();
  });

  show();

  return {
    currentId: () => steps[index]?.id ?? '',
    setSteps(updated) {
      const currentId = steps[index]?.id;
      steps = updated;
      const found = steps.findIndex(s => s.id === currentId);
      index = found === -1 ? Math.min(index, steps.length - 1) : found;
      show();
    },
    go(id) {
      const found = steps.findIndex(s => s.id === id);
      if (found === -1) return;
      index = found;
      show();
    },
    next,
    back,
    refresh: () => {
      renderHeader();
      renderFooter();
    }
  };
}
