import { MIN_MASTER_PASSWORD_LENGTH, type AccountService } from '../account/accountService';
import { WrongPasswordError } from '../account/accountCrypto';
import { CloudError } from '../account/cloudClient';
import { calculatePasswordEntropy } from '../crypto/vaultCrypto';
import { i18n } from '../i18n';
import { createEmptyVaultData } from '../store/vaultStore';
import type { UnlockedVaultData } from '../types/vault';

// Sur le web, l'API est servie à la même adresse que l'application (proxy Vite en dev, serveur BetterVault en prod)
export const DEFAULT_SERVER_URL = import.meta.env.VITE_BETTERVAULT_SERVER
  || (location.protocol === 'http:' || location.protocol === 'https:' ? location.origin : 'http://127.0.0.1:8787');

type Screen = 'unlock' | 'create' | 'signin' | 'confirm-signout';

const tr = (fr: string, en: string) => (i18n.getLocale() === 'fr' ? fr : en);

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

const EYE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const EYE_OFF = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

export function accountErrorMessage(err: unknown): string {
  if (err instanceof WrongPasswordError) return err.message;
  if (err instanceof CloudError && err.code === 'network') {
    return tr('Serveur injoignable. Vérifiez l’adresse et que le serveur est démarré.', 'Server unreachable. Check the address and that the server is running.');
  }
  return err instanceof Error ? err.message : String(err);
}

export function mountAuthScreen(root: HTMLElement, service: AccountService, onUnlocked: (data: UnlockedVaultData) => void): { show(): void } {
  const brand = () => `
    <div class="auth-brand">
      <img class="brand-logo brand-logo-dark" src="/brand/logo-on-dark.svg" alt="" width="28" height="28">
      <img class="brand-logo brand-logo-light" src="/brand/logo-on-light.svg" alt="" width="28" height="28">
      <span>BetterVault</span>
    </div>`;

  const passwordField = (id: string, label: string, autocomplete: string) => `
    <div class="form-field">
      <label class="form-label" for="${id}">${label}</label>
      <div class="input-with-actions">
        <input class="form-input" id="${id}" type="password" autocomplete="${autocomplete}" spellcheck="false" required>
        <button type="button" class="icon-btn" data-toggle-visibility="${id}" aria-pressed="false" aria-label="${tr('Afficher le mot de passe', 'Show password')}">${EYE}</button>
      </div>
    </div>`;

  const emailField = () => `
    <div class="form-field">
      <label class="form-label" for="auth-email">Email</label>
      <input class="form-input" id="auth-email" type="email" autocomplete="email" spellcheck="false" required>
    </div>`;

  const serverField = (hidden: boolean) => `
    <div class="form-field" data-server-field ${hidden ? 'hidden' : ''}>
      <label class="form-label" for="auth-server">${tr('Adresse du serveur', 'Server address')}</label>
      <input class="form-input" id="auth-server" type="url" value="${escapeHtml(DEFAULT_SERVER_URL)}" autocomplete="url" spellcheck="false">
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
          ${passwordField('auth-password', tr('Mot de passe maître', 'Master password'), 'current-password')}
          <div class="auth-error" role="alert" hidden></div>
          <button type="submit" class="btn-primary btn-accent auth-submit">${tr('Déverrouiller', 'Unlock')}</button>
        </form>
        <button type="button" class="auth-link" data-screen="confirm-signout">${tr('Utiliser un autre compte', 'Use another account')}</button>`;
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
          : tr('Ce coffre n’est pas synchronisé : toutes ses données seront définitivement supprimées de cet appareil.', 'This vault is not synced: all of its data will be permanently deleted from this device.')}</p>
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
        ${passwordField('auth-password', tr('Mot de passe maître', 'Master password'), 'new-password')}
        <div class="gen-strength" data-strength>
          <div class="strength-meter">${'<div class="strength-segment"></div>'.repeat(4)}</div>
          <span class="gen-strength-label"></span>
        </div>
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
        <p class="auth-warning">${tr('Le mot de passe maître chiffre le coffre. En cas d’oubli, les données ne peuvent pas être récupérées.', 'The master password encrypts the vault. If you forget it, the data cannot be recovered.')}</p>
        <div class="auth-error" role="alert" hidden></div>
        <button type="submit" class="btn-primary btn-accent auth-submit">${tr('Créer le coffre', 'Create vault')}</button>
      </form>`,

    signin: () => `
      ${brand()}
      ${tabs('signin')}
      <form class="auth-form" data-form="signin" novalidate>
        ${serverField(false)}
        ${emailField()}
        ${passwordField('auth-password', tr('Mot de passe maître', 'Master password'), 'current-password')}
        <div class="auth-error" role="alert" hidden></div>
        <button type="submit" class="btn-primary btn-accent auth-submit">${tr('Se connecter', 'Sign in')}</button>
      </form>`
  };

  const submit = async (form: HTMLFormElement) => {
    const kind = form.dataset.form as 'unlock' | 'create' | 'signin';
    const value = (id: string) => form.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '';
    const errorEl = form.querySelector('.auth-error') as HTMLElement;
    const button = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const fail = (message: string) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
    };
    errorEl.hidden = true;

    const password = value('auth-password');
    if (!password) return fail(tr('Saisissez le mot de passe maître', 'Enter the master password'));

    let task: () => Promise<UnlockedVaultData>;
    if (kind === 'unlock') {
      task = () => service.unlock(password);
    } else if (kind === 'create') {
      if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
        return fail(tr(`Au moins ${MIN_MASTER_PASSWORD_LENGTH} caractères`, `At least ${MIN_MASTER_PASSWORD_LENGTH} characters`));
      }
      if (password !== value('auth-password-confirm')) return fail(tr('Les mots de passe ne correspondent pas', 'Passwords do not match'));
      const mode = form.querySelector<HTMLInputElement>('input[name="auth-mode"]:checked')?.value === 'cloud' ? 'cloud' : 'local';
      const initial = createEmptyVaultData();
      initial.vaults[0].name = tr('Personnel', 'Personal');
      task = async () => {
        await service.createAccount({ email: value('auth-email'), password, mode, serverUrl: mode === 'cloud' ? value('auth-server') : undefined }, initial);
        return initial;
      };
    } else {
      task = () => service.signIn(value('auth-server'), value('auth-email'), password);
    }

    const label = button.textContent;
    button.disabled = true;
    button.textContent = kind === 'unlock'
      ? tr('Déverrouillage…', 'Unlocking…')
      : kind === 'create' ? tr('Création du coffre…', 'Creating vault…') : tr('Connexion…', 'Signing in…');

    try {
      const data = await task();
      root.hidden = true;
      root.innerHTML = '';
      onUnlocked(data);
    } catch (err) {
      fail(accountErrorMessage(err));
      if (err instanceof WrongPasswordError) form.querySelector<HTMLInputElement>('#auth-password')?.select();
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

    (card.querySelector<HTMLInputElement>(screen === 'unlock' ? '#auth-password' : '#auth-email'))?.focus();
  };

  return {
    show: () => {
      root.hidden = false;
      render(service.hasAccount() ? 'unlock' : 'create');
    }
  };
}
