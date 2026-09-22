import { currentRpId, securityKeysSupported, type SecurityKeyInfo } from '../account/securityKey';

/**
 * Section « Clés de sécurité » de la fenêtre du compte : liste, ajout, retrait.
 * Ajouter ou retirer une clé demande le mot de passe principal.
 */

export interface SecurityKeysActions {
  list(): Promise<SecurityKeyInfo[]>;
  add(password: string, name: string): Promise<SecurityKeyInfo>;
  remove(password: string, id: string): Promise<void>;
  tr(fr: string, en: string): string;
  escape(value: string): string;
  errorMessage(err: unknown): string;
  toast(message: string, kind: 'success' | 'error'): void;
  locale: string;
}

export const securityKeysSectionHtml = (tr: (fr: string, en: string) => string) => `
  <div class="switch-row" style="cursor:default;">
    <span>${tr('Clés de sécurité', 'Security keys')}<small>${tr('YubiKey, Titan, clé intégrée à l’appareil… Touchez-la pour vous connecter, à la place d’un code', 'YubiKey, Titan, built-in device key… Touch it to sign in, instead of a code')}</small></span>
    <span class="status-pill" data-keys-status>…</span>
  </div>
  <ul class="security-key-list" data-keys-list></ul>
  <div class="form-section" data-keys-add hidden></div>
  <div class="account-actions account-actions-end"><button class="btn-primary" data-action="add-key" disabled>${tr('Ajouter une clé', 'Add a key')}</button></div>`;

export function wireSecurityKeys(root: HTMLElement, a: SecurityKeysActions): void {
  const { tr } = a;
  const status = root.querySelector<HTMLElement>('[data-keys-status]');
  const list = root.querySelector<HTMLElement>('[data-keys-list]');
  const addBox = root.querySelector<HTMLElement>('[data-keys-add]');
  const addButton = root.querySelector<HTMLButtonElement>('[data-action="add-key"]');
  if (!status || !list || !addBox || !addButton) return;
  const here = currentRpId();
  let keys: SecurityKeyInfo[] = [];

  const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(a.locale) : tr('jamais', 'never'));
  const render = () => {
    status.className = `status-pill ${keys.length ? 'on' : 'off'}`;
    status.textContent = keys.length ? `${keys.length}` : tr('Aucune', 'None');
    list.innerHTML = keys.map(k => `
      <li class="security-key" data-key="${a.escape(k.id)}">
        <div class="security-key-text">
          <strong>${a.escape(k.name)}</strong>
          <small>${k.rpId === here ? tr('Cette application', 'This app') : a.escape(k.rpId)} · ${tr('ajoutée le', 'added')} ${date(k.createdAt)} · ${tr('dernière utilisation', 'last used')} ${date(k.lastUsedAt)}</small>
        </div>
        <button class="btn-primary btn-ghost btn-sm" data-key-remove>${tr('Retirer', 'Remove')}</button>
      </li>`).join('');
    const supported = securityKeysSupported();
    addButton.disabled = !supported;
    addButton.title = supported ? '' : tr('Non pris en charge par cette application ou ce navigateur', 'Not supported by this app or browser');
    list.querySelectorAll<HTMLButtonElement>('[data-key-remove]').forEach(button => button.addEventListener('click', () => {
      const id = button.closest<HTMLElement>('[data-key]')!.dataset.key!;
      openForm('remove', keys.find(k => k.id === id));
    }));
  };

  const openForm = (mode: 'add' | 'remove', key?: SecurityKeyInfo) => {
    addBox.hidden = false;
    addBox.innerHTML = `
      ${mode === 'add'
        ? `<p class="modal-text">${tr('La clé sera liée à cette application. Sur une autre (site, bureau, extension), ajoutez-la aussi, ou gardez le code de l’application d’authentification.', 'The key is tied to this app. On another one (website, desktop, extension), add it there too, or keep the authenticator app code.')}</p>
           <input class="form-input" data-key-name maxlength="40" placeholder="${tr('Nom (ex. YubiKey bleue)', 'Name (e.g. blue YubiKey)')}">`
        : `<p class="modal-text">${tr(`Retirer « ${a.escape(key?.name ?? '')} » ?`, `Remove “${a.escape(key?.name ?? '')}”?`)}</p>`}
      <input class="form-input" type="password" data-key-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
      <div class="account-actions account-actions-end">
        <button class="btn-primary btn-ghost" data-key-cancel>${tr('Annuler', 'Cancel')}</button>
        <button class="btn-primary ${mode === 'add' ? 'btn-accent' : 'btn-danger'}" data-key-confirm>${mode === 'add' ? tr('Toucher la clé', 'Touch the key') : tr('Retirer', 'Remove')}</button>
      </div>
      <div class="form-error" data-key-error hidden></div>`;
    const password = addBox.querySelector<HTMLInputElement>('[data-key-password]')!;
    const error = addBox.querySelector<HTMLElement>('[data-key-error]')!;
    (addBox.querySelector<HTMLInputElement>('[data-key-name]') ?? password).focus();
    addBox.querySelector('[data-key-cancel]')!.addEventListener('click', () => { addBox.hidden = true; addBox.innerHTML = ''; });
    const confirm = addBox.querySelector<HTMLButtonElement>('[data-key-confirm]')!;
    const submit = async () => {
      confirm.disabled = true;
      error.hidden = true;
      try {
        if (mode === 'add') {
          const name = addBox.querySelector<HTMLInputElement>('[data-key-name]')!.value.trim() || tr('Clé de sécurité', 'Security key');
          keys = [...keys, await a.add(password.value, name)];
          a.toast(tr('Clé de sécurité ajoutée', 'Security key added'), 'success');
        } else if (key) {
          await a.remove(password.value, key.id);
          keys = keys.filter(k => k.id !== key.id);
          a.toast(tr('Clé de sécurité retirée', 'Security key removed'), 'success');
        }
        addBox.hidden = true;
        addBox.innerHTML = '';
        render();
      } catch (err) {
        error.textContent = a.errorMessage(err);
        error.hidden = false;
        confirm.disabled = false;
      }
    };
    confirm.addEventListener('click', () => void submit());
    password.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } });
  };

  addButton.addEventListener('click', () => (addBox.hidden ? openForm('add') : (addBox.hidden = true)));
  a.list().then(result => {
    if (!root.isConnected) return;
    keys = result;
    render();
  }).catch(() => {
    status.textContent = tr('Serveur injoignable', 'Server unreachable');
  });
}
