export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  kind?: ToastKind;
  /** Durée d'affichage en ms (5 s pour une erreur, 3 s sinon) */
  duration?: number;
  action?: { label: string; run: () => void };
  closeLabel?: string;
}

const ICONS: Record<ToastKind, string> = {
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
  warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
};

const MAX_VISIBLE = 4;

/** Notification courte en bas de l'écran ; le texte est inséré tel quel (jamais interprété comme du HTML) */
export function showToast(message: string, options: ToastOptions = {}): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const kind = options.kind ?? 'info';
  const duration = options.duration ?? (kind === 'error' ? 5000 : 3000);

  while (container.children.length >= MAX_VISIBLE) container.firstElementChild?.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  toast.style.setProperty('--toast-duration', `${duration}ms`);
  toast.innerHTML = `
    <span class="toast-icon">${ICONS[kind]}</span>
    <span class="toast-message"></span>
    ${options.action ? '<button type="button" class="toast-action"></button>' : ''}
    <button type="button" class="toast-close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <span class="toast-progress" aria-hidden="true"></span>`;
  (toast.querySelector('.toast-message') as HTMLElement).textContent = message;
  (toast.querySelector('.toast-close') as HTMLElement).setAttribute('aria-label', options.closeLabel ?? 'Fermer');

  let remaining = duration;
  let startedAt = Date.now();
  let timer = 0;

  const dismiss = () => {
    window.clearTimeout(timer);
    if (toast.classList.contains('toast-leaving')) return;
    toast.classList.add('toast-leaving');
    window.setTimeout(() => toast.remove(), 180);
  };
  const start = () => {
    startedAt = Date.now();
    timer = window.setTimeout(dismiss, remaining);
    toast.classList.remove('toast-paused');
  };
  const pause = () => {
    window.clearTimeout(timer);
    remaining = Math.max(600, remaining - (Date.now() - startedAt));
    toast.classList.add('toast-paused');
  };

  if (options.action) {
    const button = toast.querySelector('.toast-action') as HTMLButtonElement;
    button.textContent = options.action.label;
    button.addEventListener('click', () => {
      options.action?.run();
      dismiss();
    });
  }
  toast.querySelector('.toast-close')?.addEventListener('click', dismiss);
  toast.addEventListener('mouseenter', pause);
  toast.addEventListener('mouseleave', start);
  toast.addEventListener('focusin', pause);
  toast.addEventListener('focusout', start);

  container.appendChild(toast);
  start();
}
