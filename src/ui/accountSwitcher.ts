import type { ProfileSummary } from '../account/profiles';

/**
 * Liste des comptes de l'appareil, partagée par l'écran de déverrouillage et le
 * sélecteur de l'application. Un clic sur une ligne change de compte.
 */

export interface ProfileActions {
  list(): ProfileSummary[];
  activeId(): string;
  /** Rend le compte actif puis recharge : les clés du précédent disparaissent avec la page */
  switchTo(id: string): void;
  /** Ouvre un emplacement vide et recharge sur l'écran de création / connexion */
  addNew(): void;
  forget(id: string): void;
}

type Tr = (fr: string, en: string) => string;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/** Le nom du serveur suffit à distinguer deux comptes de même adresse */
export function serverLabel(profile: Pick<ProfileSummary, 'mode' | 'serverUrl'>, tr: Tr): string {
  if (profile.mode !== 'cloud') return tr('Sur cet appareil', 'On this device');
  try {
    return new URL(profile.serverUrl ?? '').host;
  } catch {
    return profile.serverUrl ?? tr('Serveur', 'Server');
  }
}

const initial = (email: string) => escapeHtml((email.trim().charAt(0) || '?').toUpperCase());

export function profileRowsHtml(actions: ProfileActions, tr: Tr, options: { forgettable?: boolean } = {}): string {
  const active = actions.activeId();
  return actions.list().map(profile => {
    const courant = profile.id === active;
    return `
      <div class="profile-row-item${courant ? ' current' : ''}">
        <button type="button" class="profile-pick" data-profile-id="${escapeHtml(profile.id)}" ${courant ? 'aria-current="true"' : ''}>
          <span class="profile-avatar">${initial(profile.email)}</span>
          <span class="profile-text">
            <span class="profile-email">${escapeHtml(profile.email)}</span>
            <span class="profile-server">${escapeHtml(serverLabel(profile, tr))}</span>
          </span>
          ${courant ? `<span class="profile-badge">${tr('Actuel', 'Current')}</span>` : ''}
        </button>
        ${options.forgettable && !courant ? `
          <button type="button" class="icon-btn profile-forget" data-forget-profile="${escapeHtml(profile.id)}"
            title="${tr('Oublier sur cet appareil', 'Forget on this device')}" aria-label="${tr('Oublier', 'Forget')} ${escapeHtml(profile.email)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : ''}
      </div>`;
  }).join('');
}

/** Branche les clics d'une liste rendue par profileRowsHtml */
export function wireProfileRows(
  host: HTMLElement,
  actions: ProfileActions,
  confirmForget: (email: string) => Promise<boolean>
): void {
  host.addEventListener('click', async event => {
    const target = event.target as HTMLElement;
    const forget = target.closest<HTMLElement>('[data-forget-profile]')?.dataset.forgetProfile;
    if (forget) {
      const profile = actions.list().find(p => p.id === forget);
      if (profile && await confirmForget(profile.email)) {
        actions.forget(forget);
        target.closest('.profile-row-item')?.remove();
      }
      return;
    }
    const id = target.closest<HTMLElement>('[data-profile-id]')?.dataset.profileId;
    if (id && id !== actions.activeId()) actions.switchTo(id);
  });
}
