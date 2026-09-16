import { MIN_MASTER_PASSWORD_LENGTH, type AccountService } from '../account/accountService';
import { InvalidRecoveryKeyError, WrongPasswordError } from '../account/accountCrypto';
import { CloudError, isTotpRequired } from '../account/cloudClient';
import { calculatePasswordEntropy } from '../crypto/vaultCrypto';
import { i18n } from '../i18n';
import { downloadExportFile } from '../import_export/importEngine';
import { createEmptyVaultData } from '../store/vaultStore';
import type { UnlockedVaultData } from '../types/vault';
import { printRecoveryKey, recoveryKeyFile } from './recoveryKey';
import { BiometricCancelledError, type DeviceSecretStore } from '../platform/biometric';
import { renderSVG } from 'uqr';
import { secretGridHtml } from './secretDisplay';

const isTauriRuntime = typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';

// Sur le web, l'API est servie à la même adresse que l'application (proxy Vite en dev, serveur BetterVault en prod).
// L'application de bureau et l'extension n'ont pas d'origine HTTP propre : serveur local par défaut.
export const DEFAULT_SERVER_URL = import.meta.env.VITE_BETTERVAULT_SERVER
  || (!isTauriRuntime && (location.protocol === 'http:' || location.protocol === 'https:') ? location.origin : 'http://127.0.0.1:8787');

type Screen = 'unlock' | 'create' | 'signin' | 'confirm-signout' | 'recover' | 'recovery-key' | 'totp-offer';

const tr = (fr: string, en: string) => (i18n.getLocale() === 'fr' ? fr : en);

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

const EYE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const SAVE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
const PRINT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>';

/** Copie avec retour visuel sur le bouton, sans changer sa largeur */
async function copyToClipboard(button: HTMLButtonElement, value: string): Promise<void> {
  const label = button.querySelector('span') ?? button;
  const original = label.textContent;
  try {
    await navigator.clipboard.writeText(value);
    label.textContent = tr('Copié', 'Copied');
  } catch {
    label.textContent = tr('Copie impossible', 'Copy failed');
  }
  setTimeout(() => { if (label.isConnected) label.textContent = original; }, 2000);
}

const EYE_OFF = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

export function accountErrorMessage(err: unknown): string {
  if (err instanceof WrongPasswordError || err instanceof InvalidRecoveryKeyError) return err.message;
  if (err instanceof CloudError && err.code === 'network') {
    return tr('Serveur injoignable. Vérifiez l’adresse et que le serveur est démarré.', 'Server unreachable. Check the address and that the server is running.');
  }
  return err instanceof Error ? err.message : String(err);
}

export function mountAuthScreen(
  root: HTMLElement,
  service: AccountService,
  onUnlocked: (data: UnlockedVaultData) => void,
  options: { deviceStore?: DeviceSecretStore | null } = {}
): { show(): void } {
  // Données à ouvrir une fois la clé de secours confirmée
  let pending: { data: UnlockedVaultData; key: string; intro: string; offerTotp?: boolean } | null = null;
  // Mot de passe gardé en mémoire le temps de proposer la double authentification après la création
  let newAccountPassword: string | null = null;
  // L'invite biométrique s'ouvre d'elle-même une seule fois par affichage de l'écran
  let autoPrompted = false;

  const brand = () => `
    <div class="auth-brand">
      <img class="brand-logo brand-logo-dark" src="/brand/logo-on-dark.svg" alt="" width="28" height="28">
      <img class="brand-logo brand-logo-light" src="/brand/logo-on-light.svg" alt="" width="28" height="28">
      <span>BetterVault</span>
    </div>`;

  const passwordField = (id: string, label: string, autocomplete: string, required = true) => `
    <div class="form-field">
      <label class="form-label" for="${id}">${label}</label>
      <div class="input-with-actions">
        <input class="form-input" id="${id}" type="password" autocomplete="${autocomplete}" spellcheck="false" ${required ? 'required' : ''}>
        <button type="button" class="icon-btn" data-toggle-visibility="${id}" aria-pressed="false" aria-label="${tr('Afficher le mot de passe', 'Show password')}">${EYE}</button>
      </div>
    </div>`;

  const emailField = (value = '') => `
    <div class="form-field">
      <label class="form-label" for="auth-email">Email</label>
      <input class="form-input" id="auth-email" type="email" autocomplete="email" spellcheck="false" value="${escapeHtml(value)}" required>
    </div>`;

  const serverField = (hidden: boolean, value = DEFAULT_SERVER_URL) => `
    <div class="form-field" data-server-field ${hidden ? 'hidden' : ''}>
      <label class="form-label" for="auth-server">${tr('Adresse du serveur', 'Server address')}</label>
      <input class="form-input" id="auth-server" type="url" value="${escapeHtml(value)}" autocomplete="url" spellcheck="false">
    </div>`;

  const otpField = (id: string, label: string, hint: string, hidden = false) => `
    <div class="form-field" data-field="${id}" ${hidden ? 'hidden' : ''}>
      <label class="form-label" for="${id}">${label}</label>
      <input class="form-input otp-input" id="${id}" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
    </div>`;

  const strengthMeter = () => `
    <div class="gen-strength" data-strength>
      <div class="strength-meter">${'<div class="strength-segment"></div>'.repeat(4)}</div>
      <span class="gen-strength-label"></span>
    </div>`;

  const tabs = (active: 'create' | 'signin') => `
    <div class="tab-btn-group" role="tablist">
      <button type="button" class="tab-btn ${active === 'create' ? 'active' : ''}" role="tab" aria-selected="${active === 'create'}" data-screen="create">${tr('Créer un compte', 'Create account')}</button>
      <button type="button" class="tab-btn ${active === 'signin' ? 'active' : ''}" role="tab" aria-selected="${active === 'signin'}" data-screen="signin">${tr('Se connecter', 'Sign in')}</button>
    </div>`;

  const templates: Record<Screen, () => string> = {
    unlock: () => {
      const account = service.getAccount();
      return `
        ${brand()}
        <div>
          <h1 class="auth-title">${tr('Déverrouiller', 'Unlock')}</h1>
          <p class="auth-sub">${escapeHtml(account?.email ?? '')} · ${account?.mode === 'cloud' ? tr('synchronisé', 'synced') : tr('sur cet appareil', 'on this device')}</p>
        </div>
        <form class="auth-form" data-form="unlock" novalidate>
          ${passwordField('auth-password', tr('Mot de passe principal', 'Master password'), 'current-password')}
          <div class="auth-error" role="alert" hidden></div>
          <button type="submit" class="btn-primary btn-accent auth-submit">${tr('Déverrouiller', 'Unlock')}</button>
          ${options.deviceStore && service.hasDeviceUnlock() ? `
            <button type="button" class="btn-primary auth-submit" data-action="device-unlock">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 11c0 3.5-1 6.5-3 9"/><path d="M8 7.5A5 5 0 0 1 17 11c0 3-.5 5.5-1.5 8"/><path d="M4.5 9a8 8 0 0 1 15 2c0 2-.2 4-.7 6"/><path d="M12 15c-.3 2-1 4-2 5.5"/></svg>
              ${tr(`Utiliser ${options.deviceStore.label}`, `Use ${options.deviceStore.label}`)}
            </button>` : ''}
        </form>
        <div style="display:flex;justify-content:center;gap:16px;flex-wrap:wrap;">
          <button type="button" class="auth-link" data-screen="recover">${tr('Mot de passe oublié ?', 'Forgot password?')}</button>
          <button type="button" class="auth-link" data-screen="confirm-signout">${tr('Utiliser un autre compte', 'Use another account')}</button>
        </div>`;
    },

    'confirm-signout': () => {
      const account = service.getAccount();
      return `
        ${brand()}
        <div>
          <h1 class="auth-title">${tr('Retirer ce compte ?', 'Remove this account?')}</h1>
          <p class="auth-sub">${escapeHtml(account?.email ?? '')}</p>
        </div>
        <p class="auth-warning">${account?.mode === 'cloud'
          ? tr('Le coffre reste sur le serveur. Les modifications de cet appareil qui n’ont pas été synchronisées seront perdues.', 'The vault stays on the server. Changes on this device that were not synced will be lost.')
          : tr('Ce coffre n’est pas synchronisé : toutes ses données seront supprimées de cet appareil.', 'This vault is not synced: all of its data will be deleted from this device.')}</p>
        <div class="auth-form">
          <button type="button" class="btn-primary btn-danger auth-submit" data-action="signout">${tr('Retirer le compte de cet appareil', 'Remove account from this device')}</button>
          <button type="button" class="btn-primary btn-ghost auth-submit" data-screen="unlock">${tr('Annuler', 'Cancel')}</button>
        </div>`;
    },

    create: () => `
      ${brand()}
      ${tabs('create')}
      <form class="auth-form" data-form="create" novalidate>
        ${emailField()}
        ${passwordField('auth-password', tr('Mot de passe principal', 'Master password'), 'new-password')}
        ${strengthMeter()}
        ${passwordField('auth-password-confirm', tr('Confirmer le mot de passe', 'Confirm password'), 'new-password')}
        <fieldset class="auth-choice">
          <legend class="form-label">${tr('Stockage', 'Storage')}</legend>
          <label>
            <input type="radio" name="auth-mode" value="local" checked>
            <span class="auth-choice-title">${tr('Cet appareil', 'This device')}</span>
            <span class="auth-choice-sub">${tr('Rien n’est envoyé', 'Nothing is uploaded')}</span>
          </label>
          <label>
            <input type="radio" name="auth-mode" value="cloud">
            <span class="auth-choice-title">${tr('Synchronisé', 'Synced')}</span>
            <span class="auth-choice-sub">${tr('Chiffré sur un serveur', 'Encrypted on a server')}</span>
          </label>
        </fieldset>
        ${serverField(true)}
        <label class="check-row" data-terms hidden>
          <input type="checkbox" data-accept-terms>
          <span>${tr('J’accepte les', 'I accept the')} <a data-legal="terms" target="_blank" rel="noopener">${tr('conditions d’utilisation', 'terms of use')}</a> ${tr('et la', 'and the')} <a data-legal="privacy" target="_blank" rel="noopener">${tr('politique de confidentialité', 'privacy policy')}</a> ${tr('de ce serveur', 'of this server')}</span>
        </label>
        <p class="auth-warning">${tr('Ce mot de passe chiffre le coffre et n’est jamais envoyé. Une clé de secours vous sera donnée pour pouvoir le changer si vous l’oubliez.', 'This password encrypts the vault and is never sent. You will get a recovery key to reset it if you forget it.')}</p>
        <div class="auth-error" role="alert" hidden></div>
        <button type="submit" class="btn-primary btn-accent auth-submit">${tr('Créer le coffre', 'Create vault')}</button>
      </form>`,

    signin: () => `
      ${brand()}
      ${tabs('signin')}
      <form class="auth-form" data-form="signin" novalidate>
        ${serverField(false)}
        ${emailField()}
        ${passwordField('auth-password', tr('Mot de passe principal', 'Master password'), 'current-password')}
        ${otpField('auth-totp', tr('Code de l’application d’authentification', 'Authenticator app code'), '', true)}
        <div class="auth-error" role="alert" hidden></div>
        <button type="submit" class="btn-primary btn-accent auth-submit">${tr('Se connecter', 'Sign in')}</button>
      </form>
      <button type="button" class="auth-link" data-screen="recover">${tr('Mot de passe oublié ?', 'Forgot password?')}</button>`,

    recover: () => {
      const account = service.getAccount();
      const backScreen = account ? 'unlock' : 'signin';
      if (account?.mode === 'local') {
        return `
          ${brand()}
          <div>
            <h1 class="auth-title">${tr('Mot de passe oublié', 'Forgot password')}</h1>
            <p class="auth-sub">${escapeHtml(account.email)} · ${tr('sur cet appareil', 'on this device')}</p>
          </div>
          <form class="auth-form" data-form="recover-local" novalidate>
            <div class="form-field">
              <label class="form-label" for="auth-recovery-key">${tr('Clé de secours', 'Recovery key')}</label>
              <textarea class="form-input" id="auth-recovery-key" rows="3" spellcheck="false" autocomplete="off" style="font-family:var(--font-mono);resize:none;" placeholder="ABCD-EFGH-…"></textarea>
              <span class="field-hint">${tr('Donnée à la création du compte, 52 caractères', 'Given when the account was created, 52 characters')}</span>
            </div>
            ${passwordField('auth-password', tr('Nouveau mot de passe principal', 'New master password'), 'new-password')}
            ${strengthMeter()}
            ${passwordField('auth-password-confirm', tr('Confirmer', 'Confirm'), 'new-password')}
            <div class="auth-error" role="alert" hidden></div>
            <button type="submit" class="btn-primary btn-accent auth-submit">${tr('Changer le mot de passe', 'Change password')}</button>
          </form>
          <button type="button" class="auth-link" data-screen="${backScreen}">${tr('Retour', 'Back')}</button>`;
      }
      return `
        ${brand()}
        <div>
          <h1 class="auth-title">${tr('Mot de passe oublié', 'Forgot password')}</h1>
          <p class="auth-sub">${tr('Compte synchronisé', 'Synced account')}</p>
        </div>
        <form class="auth-form" data-form="recover-cloud" novalidate>
          ${serverField(false, account?.serverUrl ?? DEFAULT_SERVER_URL)}
          ${emailField(account?.email ?? '')}
          <div class="account-actions">
            <button type="button" class="btn-primary" data-action="send-code">${tr('Recevoir un code par email', 'Get a code by email')}</button>
            <span class="field-hint" data-code-status style="align-self:center;"></span>
          </div>
          ${otpField('auth-email-code', tr('Code reçu par email', 'Code from the email'), '', true)}
          <div class="form-field">
            <label class="form-label" for="auth-recovery-key">${tr('Clé de secours', 'Recovery key')}</label>
            <textarea class="form-input" id="auth-recovery-key" rows="3" spellcheck="false" autocomplete="off" style="font-family:var(--font-mono);resize:none;" placeholder="ABCD-EFGH-…"></textarea>
            <span class="field-hint">${tr('Avec la clé, le coffre est conservé', 'With the key, the vault is kept')}</span>
          </div>
          ${otpField('auth-totp', tr('Code de l’application d’authentification', 'Authenticator app code'), tr('Seulement si la double authentification est activée', 'Only if two-factor authentication is on'))}
          ${passwordField('auth-password', tr('Nouveau mot de passe principal', 'New master password'), 'new-password')}
          ${strengthMeter()}
          ${passwordField('auth-password-confirm', tr('Confirmer', 'Confirm'), 'new-password')}
          <div data-no-key-warning>
            <p class="auth-warning">${tr('Sans clé de secours, le coffre est remplacé par un coffre vide : les identifiants enregistrés sont perdus.', 'Without a recovery key, the vault is replaced with an empty one: saved credentials are lost.')}</p>
            <label class="check-row" style="margin-top:8px;"><input type="checkbox" data-accept-reset> ${tr('Je comprends, réinitialiser quand même', 'I understand, reset anyway')}</label>
          </div>
          <div class="auth-error" role="alert" hidden></div>
          <button type="submit" class="btn-primary btn-accent auth-submit">${tr('Réinitialiser le mot de passe', 'Reset password')}</button>
        </form>
        <button type="button" class="auth-link" data-screen="${backScreen}">${tr('Retour', 'Back')}</button>`;
    },

    'recovery-key': () => `
      ${brand()}
      <div>
        <h1 class="auth-title">${tr('Votre clé de secours', 'Your recovery key')}</h1>
        <p class="auth-sub">${escapeHtml(pending?.intro ?? '')}</p>
      </div>
      <div class="secret-card">
        <div class="secret-card-head">
          <span class="secret-card-label">${tr('52 caractères · affichée une seule fois', '52 characters · shown only once')}</span>
          <button type="button" class="btn-primary btn-ghost btn-sm" data-action="copy-key">${COPY_ICON}<span>${tr('Copier', 'Copy')}</span></button>
        </div>
        ${secretGridHtml(pending?.key ?? '')}
      </div>
      <div class="recovery-actions">
        <button type="button" class="btn-primary" data-action="download-key">${SAVE_ICON}<span>${tr('Enregistrer en .txt', 'Save as .txt')}</span></button>
        <button type="button" class="btn-primary" data-action="print-key">${PRINT_ICON}<span>${tr('Imprimer', 'Print')}</span></button>
      </div>
      <p class="auth-warning">${tr('Gardez-la hors de BetterVault (papier, gestionnaire de mots de passe d’un proche, coffre-fort). Elle ne sera plus affichée.', 'Keep it outside BetterVault (paper, a relative’s password manager, a safe). It won’t be shown again.')}</p>
      <label class="check-row"><input type="checkbox" data-confirm-key> ${tr('J’ai mis ma clé de secours en lieu sûr', 'I stored my recovery key somewhere safe')}</label>
      <button type="button" class="btn-primary btn-accent auth-submit" data-action="continue" disabled>${tr('Terminer', 'Finish')}</button>`,

    'totp-offer': () => `
      ${brand()}
      <div>
        <h1 class="auth-title">${tr('Double authentification', 'Two-factor authentication')}</h1>
        <p class="auth-sub">${tr('Recommandé : même avec votre mot de passe, personne ne pourra se connecter au serveur sans le code de votre téléphone.', 'Recommended: even with your password, nobody can sign in to the server without the code from your phone.')}</p>
      </div>
      <div class="auth-form" data-totp-step>
        <div class="totp-setup totp-setup-auth">
          <div class="qr-box" data-totp-qr aria-label="QR code"><span class="skeleton skeleton-block"></span></div>
          <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
            <ol class="ie-steps">
              <li>${tr('Scannez le QR code avec Aegis, 2FAS, Google Authenticator…', 'Scan the QR code with Aegis, 2FAS, Google Authenticator…')}</li>
              <li>${tr('Saisissez le code à 6 chiffres affiché', 'Enter the 6-digit code shown')}</li>
            </ol>
            <div class="secret-card compact">
              <div class="secret-card-head">
                <span class="secret-card-label">${tr('Clé de configuration', 'Setup key')}</span>
                <button type="button" class="btn-primary btn-ghost btn-sm" data-action="copy-totp">${COPY_ICON}<span>${tr('Copier', 'Copy')}</span></button>
              </div>
              <div data-totp-secret><span class="skeleton skeleton-line" style="width:80%"></span></div>
            </div>
          </div>
        </div>
        ${otpField('auth-totp-new', tr('Code de l’application', 'App code'), '')}
        <div class="auth-error" role="alert" hidden></div>
        <button type="button" class="btn-primary btn-accent auth-submit" data-action="totp-enable">${tr('Activer', 'Turn on')}</button>
        <button type="button" class="btn-primary btn-ghost auth-submit" data-action="totp-skip">${tr('Plus tard', 'Later')}</button>
      </div>
      <p class="field-hint" style="text-align:center;">${tr('Modifiable à tout moment dans Compte › Sécurité.', 'You can change this anytime in Account › Security.')}</p>`
  };

  const finish = (data: UnlockedVaultData) => {
    root.hidden = true;
    root.innerHTML = '';
    onUnlocked(data);
  };

  const submit = async (form: HTMLFormElement) => {
    const kind = form.dataset.form as 'unlock' | 'create' | 'signin' | 'recover-local' | 'recover-cloud';
    const value = (id: string) => form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value ?? '';
    const errorEl = form.querySelector('.auth-error') as HTMLElement;
    const button = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const fail = (message: string) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
    };
    errorEl.hidden = true;

    const password = value('auth-password');
    const isNewPassword = kind === 'create' || kind === 'recover-local' || kind === 'recover-cloud';
    if (!password) return fail(isNewPassword ? tr('Choisissez un mot de passe principal', 'Choose a master password') : tr('Saisissez le mot de passe principal', 'Enter the master password'));
    if (isNewPassword) {
      if (password.length < MIN_MASTER_PASSWORD_LENGTH) return fail(tr(`Au moins ${MIN_MASTER_PASSWORD_LENGTH} caractères`, `At least ${MIN_MASTER_PASSWORD_LENGTH} characters`));
      if (password !== value('auth-password-confirm')) return fail(tr('Les deux mots de passe sont différents', 'The two passwords are different'));
    }

    let task: () => Promise<void>;
    if (kind === 'unlock') {
      task = async () => finish(await service.unlock(password));
    } else if (kind === 'create') {
      const mode = form.querySelector<HTMLInputElement>('input[name="auth-mode"]:checked')?.value === 'cloud' ? 'cloud' : 'local';
      const initial = createEmptyVaultData();
      initial.vaults[0].name = tr('Personnel', 'Personal');
      if (mode === 'cloud' && !form.querySelector<HTMLInputElement>('[data-accept-terms]')?.checked) {
        return fail(tr('Acceptez les conditions d’utilisation du serveur pour créer un compte synchronisé', 'Accept the server’s terms of use to create a synced account'));
      }
      task = async () => {
        const { recoveryKey } = await service.createAccount({ email: value('auth-email'), password, mode, serverUrl: mode === 'cloud' ? value('auth-server') : undefined }, initial);
        if (mode === 'cloud') newAccountPassword = password;
        pending = { data: initial, key: recoveryKey, intro: tr('Si vous oubliez votre mot de passe principal, cette clé permet d’en choisir un nouveau sans perdre vos données.', 'If you forget your master password, this key lets you choose a new one without losing your data.') };
        render(mode === 'cloud' ? 'totp-offer' : 'recovery-key');
      };
    } else if (kind === 'signin') {
      task = async () => finish(await service.signIn(value('auth-server'), value('auth-email'), password, value('auth-totp') || undefined));
    } else if (kind === 'recover-local') {
      task = async () => finish(await service.recoverLocalAccount(value('auth-recovery-key'), password));
    } else {
      const hasKey = !!value('auth-recovery-key').trim();
      if (!hasKey && !form.querySelector<HTMLInputElement>('[data-accept-reset]')?.checked) {
        return fail(tr('Saisissez la clé de secours, ou cochez la case pour repartir d’un coffre vide', 'Enter the recovery key, or tick the box to start from an empty vault'));
      }
      task = async () => {
        const result = await service.recoverCloudAccount({
          serverUrl: value('auth-server'),
          email: value('auth-email'),
          newPassword: password,
          recoveryKey: value('auth-recovery-key') || undefined,
          emailCode: value('auth-email-code') || undefined,
          totp: value('auth-totp') || undefined
        });
        if (result.newRecoveryKey) {
          pending = {
            data: result.data,
            key: result.newRecoveryKey,
            intro: tr('Le compte repart avec un coffre vide. Voici sa nouvelle clé de secours.', 'The account starts again with an empty vault. Here is its new recovery key.')
          };
          render('recovery-key');
        } else {
          finish(result.data);
        }
      };
    }

    const label = button.textContent;
    button.disabled = true;
    button.textContent = kind === 'unlock' ? tr('Déverrouillage…', 'Unlocking…')
      : kind === 'create' ? tr('Création du coffre…', 'Creating vault…')
      : kind === 'signin' ? tr('Connexion…', 'Signing in…') : tr('Vérification…', 'Checking…');

    try {
      await task();
    } catch (err) {
      if (isTotpRequired(err)) {
        const field = form.querySelector<HTMLElement>('[data-field="auth-totp"]');
        if (field) field.hidden = false;
        fail(tr('Saisissez le code à 6 chiffres de votre application d’authentification', 'Enter the 6-digit code from your authenticator app'));
        form.querySelector<HTMLInputElement>('#auth-totp')?.focus();
      } else {
        fail(accountErrorMessage(err));
        if (err instanceof WrongPasswordError && kind === 'unlock') form.querySelector<HTMLInputElement>('#auth-password')?.select();
      }
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  };

  const render = (screen: Screen) => {
    root.innerHTML = `<div class="auth-card">${templates[screen]()}</div>`;
    const card = root.firstElementChild as HTMLElement;

    card.querySelectorAll<HTMLElement>('[data-screen]').forEach(el => {
      el.addEventListener('click', () => render(el.dataset.screen as Screen));
    });

    card.querySelectorAll<HTMLButtonElement>('[data-toggle-visibility]').forEach(button => {
      button.addEventListener('click', () => {
        const input = card.querySelector<HTMLInputElement>(`#${button.dataset.toggleVisibility}`);
        if (!input) return;
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        button.innerHTML = visible ? EYE_OFF : EYE;
        button.setAttribute('aria-pressed', String(visible));
      });
    });

    card.querySelectorAll<HTMLInputElement>('input[name="auth-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const field = card.querySelector<HTMLElement>('[data-server-field]');
        if (field) field.hidden = radio.value !== 'cloud';
      });
    });

    const passwordInput = card.querySelector<HTMLInputElement>('#auth-password');
    const strength = card.querySelector<HTMLElement>('[data-strength]');
    if (passwordInput && strength) {
      passwordInput.addEventListener('input', () => {
        const s = calculatePasswordEntropy(passwordInput.value);
        strength.querySelectorAll<HTMLElement>('.strength-segment').forEach((segment, i) => {
          segment.style.backgroundColor = passwordInput.value && i < s.score ? s.color : '';
        });
        const labelEl = strength.querySelector('.gen-strength-label') as HTMLElement;
        labelEl.style.color = s.color;
        labelEl.textContent = !passwordInput.value
          ? ''
          : passwordInput.value.length < MIN_MASTER_PASSWORD_LENGTH
            ? tr(`${MIN_MASTER_PASSWORD_LENGTH} caractères minimum`, `${MIN_MASTER_PASSWORD_LENGTH} characters minimum`)
            : `${s.label} · ${s.bits} bits`;
      });
    }

    // Réinitialisation d'un compte synchronisé : avertissement tant qu'aucune clé n'est saisie, envoi du code email
    const keyInput = card.querySelector<HTMLTextAreaElement>('#auth-recovery-key');
    const noKeyWarning = card.querySelector<HTMLElement>('[data-no-key-warning]');
    if (keyInput && noKeyWarning) {
      const update = () => { noKeyWarning.hidden = !!keyInput.value.trim(); };
      keyInput.addEventListener('input', update);
      update();
    }
    card.querySelector<HTMLButtonElement>('[data-action="send-code"]')?.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement;
      const status = card.querySelector<HTMLElement>('[data-code-status]')!;
      const errorEl = card.querySelector<HTMLElement>('.auth-error')!;
      errorEl.hidden = true;
      button.disabled = true;
      status.textContent = tr('Envoi…', 'Sending…');
      try {
        const email = card.querySelector<HTMLInputElement>('#auth-email')!.value;
        const server = card.querySelector<HTMLInputElement>('#auth-server')!.value;
        const { emailCodeRequired } = await service.requestRecoveryCode(server, email);
        const field = card.querySelector<HTMLElement>('[data-field="auth-email-code"]');
        if (field) field.hidden = !emailCodeRequired;
        status.textContent = emailCodeRequired
          ? tr('Si un compte existe pour cet email, un code vient d’être envoyé (valable 15 minutes).', 'If an account exists for this email, a code was just sent (valid 15 minutes).')
          : tr('Ce serveur n’envoie pas d’emails : la clé de secours ou la double authentification suffit.', 'This server doesn’t send emails: the recovery key or two-factor authentication is enough.');
        if (emailCodeRequired) card.querySelector<HTMLInputElement>('#auth-email-code')?.focus();
      } catch (err) {
        status.textContent = '';
        errorEl.textContent = accountErrorMessage(err);
        errorEl.hidden = false;
      } finally {
        button.disabled = false;
      }
    });

    // Écran de la clé de secours
    const account = () => service.getAccount();
    card.querySelector<HTMLButtonElement>('[data-action="copy-key"]')?.addEventListener('click', event => {
      void copyToClipboard(event.currentTarget as HTMLButtonElement, pending?.key ?? '');
    });
    card.querySelector<HTMLButtonElement>('[data-action="print-key"]')?.addEventListener('click', () => {
      if (pending) printRecoveryKey(account()?.email ?? '', pending.key);
    });
    card.querySelector<HTMLButtonElement>('[data-action="download-key"]')?.addEventListener('click', () => {
      if (!pending) return;
      downloadExportFile(recoveryKeyFile(account()?.email ?? '', pending.key, tr, i18n.getLocale() === 'fr' ? 'fr-FR' : 'en-US'), 'bettervault-cle-de-secours.txt', 'text/plain;charset=utf-8');
    });
    const continueButton = card.querySelector<HTMLButtonElement>('[data-action="continue"]');
    card.querySelector<HTMLInputElement>('[data-confirm-key]')?.addEventListener('change', e => {
      if (continueButton) continueButton.disabled = !(e.target as HTMLInputElement).checked;
    });
    continueButton?.addEventListener('click', () => {
      if (!pending) return;
      const data = pending.data;
      pending = null;
      newAccountPassword = null;
      finish(data);
    });

    // Création d'un compte synchronisé : liens vers les documents du serveur choisi
    const termsRow = card.querySelector<HTMLElement>('[data-terms]');
    if (termsRow) {
      const serverInput = card.querySelector<HTMLInputElement>('#auth-server');
      const updateTerms = () => {
        const cloud = card.querySelector<HTMLInputElement>('input[name="auth-mode"]:checked')?.value === 'cloud';
        termsRow.hidden = !cloud;
        const base = (serverInput?.value ?? '').trim().replace(/\/+$/, '');
        termsRow.querySelectorAll<HTMLAnchorElement>('[data-legal]').forEach(link => {
          if (/^https?:\/\//.test(base)) link.href = `${base}/legal/${link.dataset.legal}`;
          else link.removeAttribute('href');
        });
      };
      serverInput?.addEventListener('input', updateTerms);
      card.querySelectorAll<HTMLInputElement>('input[name="auth-mode"]').forEach(radio => radio.addEventListener('change', updateTerms));
      updateTerms();
    }

    // Proposition de double authentification juste après la création du compte
    const totpStep = card.querySelector<HTMLElement>('[data-totp-step]');
    if (totpStep && pending) {
      // Activee ou reportee, l'etape suivante reste la cle de secours
      const done = () => {
        newAccountPassword = null;
        render('recovery-key');
      };
      const errorEl = totpStep.querySelector<HTMLElement>('.auth-error')!;
      let totpSecret = '';
      totpStep.querySelector('[data-action="copy-totp"]')?.addEventListener('click', event => {
        void copyToClipboard(event.currentTarget as HTMLButtonElement, totpSecret);
      });
      const enableButton = totpStep.querySelector<HTMLButtonElement>('[data-action="totp-enable"]')!;
      const codeInput = totpStep.querySelector<HTMLInputElement>('#auth-totp-new')!;
      enableButton.disabled = true;
      totpStep.querySelector('[data-action="totp-skip"]')?.addEventListener('click', done);
      service.beginTotpSetup(newAccountPassword ?? '').then(setup => {
        if (!totpStep.isConnected) return;
        totpStep.querySelector('[data-totp-qr]')!.innerHTML = renderSVG(setup.uri, { border: 1 });
        totpSecret = setup.secret;
        totpStep.querySelector('[data-totp-secret]')!.innerHTML = secretGridHtml(setup.secret, { numbered: false });
        enableButton.disabled = false;
        codeInput.focus();
      }).catch(err => {
        errorEl.textContent = accountErrorMessage(err);
        errorEl.hidden = false;
      });
      const enable = async () => {
        errorEl.hidden = true;
        enableButton.disabled = true;
        try {
          await service.enableTotp(codeInput.value);
          done();
        } catch (err) {
          errorEl.textContent = accountErrorMessage(err);
          errorEl.hidden = false;
          codeInput.select();
          enableButton.disabled = false;
        }
      };
      enableButton.addEventListener('click', () => void enable());
      codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') void enable(); });
      codeInput.addEventListener('input', () => { if (/^\d{6}$/.test(codeInput.value.trim())) void enable(); });
    }

    const deviceButton = card.querySelector<HTMLButtonElement>('[data-action="device-unlock"]');
    if (deviceButton && options.deviceStore) {
      const store = options.deviceStore;
      const unlockWithDevice = async () => {
        const errorEl = card.querySelector<HTMLElement>('.auth-error')!;
        errorEl.hidden = true;
        deviceButton.disabled = true;
        try {
          finish(await service.unlockWithDevice(store, tr('Déverrouiller BetterVault', 'Unlock BetterVault')));
        } catch (err) {
          if (!(err instanceof BiometricCancelledError)) {
            errorEl.textContent = accountErrorMessage(err);
            errorEl.hidden = false;
          }
        } finally {
          if (deviceButton.isConnected) deviceButton.disabled = false;
        }
      };
      deviceButton.addEventListener('click', () => void unlockWithDevice());
      if (!autoPrompted) {
        autoPrompted = true;
        void store.available().then(ok => { if (ok && deviceButton.isConnected) void unlockWithDevice(); });
      }
    }

    card.querySelector<HTMLButtonElement>('[data-action="signout"]')?.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      await service.signOut();
      render('create');
    });

    const form = card.querySelector<HTMLFormElement>('form');
    form?.addEventListener('submit', event => {
      event.preventDefault();
      void submit(form);
    });

    const focusTarget = screen === 'unlock' ? '#auth-password' : screen === 'recover' ? (service.getAccount()?.mode === 'local' ? '#auth-recovery-key' : '#auth-email') : '#auth-email';
    card.querySelector<HTMLElement>(focusTarget)?.focus();
  };

  return {
    show: () => {
      root.hidden = false;
      autoPrompted = false;
      render(service.hasAccount() ? 'unlock' : 'create');
    }
  };
}
