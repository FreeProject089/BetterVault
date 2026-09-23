import { downloadExportFile } from '../import_export/importEngine';
import { type AccountSession } from '../account/cloudClient';
import { openExternal } from '../platform/tauriBridge';
import { accountErrorMessage, DEFAULT_SERVER_URL } from '../ui/authScreen';
import { secretGridHtml } from '../ui/secretDisplay';
import { resizeAvatar } from '../ui/avatarImage';
import { translateError } from '../i18n/errorMessages';
import { tabIcon } from '../ui/tabIcons';
import { securityKeysSectionHtml, wireSecurityKeys } from '../ui/securityKeysPanel';
import { GEN_ICONS } from '../ui/icons';
import { loadSavedTheme, parseTheme, PRESET_THEMES, saveTheme, ThemeError, themeTemplate } from '../ui/themes';
import { renderSVG } from 'uqr';
import { i18n } from '../i18n';
import type { AppController } from '../main';
import { accountService } from '../app/services';

/** Fenêtre du compte : synchronisation, sécurité, sessions, offre, données */
export function openAccountModal(app: AppController): void {
  const account = accountService.getAccount();
  if (!account) return;
  const isCloud = account.mode === 'cloud';
  const locale = app.dateLocale();
  const limits = accountService.getLimits();
  const tr = (fr: string, en: string) => app.tr(fr, en);
  const hasRecovery = accountService.hasRecoveryKey();

  const limitRows: Array<[string, string]> = [
    [tr('Coffres', 'Vaults'), limits.maxVaults.toLocaleString(locale)],
    [tr('Identifiants par coffre', 'Credentials per vault'), limits.maxCredentialsPerVault.toLocaleString(locale)],
    [tr('Tâches par coffre', 'Tasks per vault'), limits.maxTasksPerVault.toLocaleString(locale)],
    [tr('Longueur d’une note', 'Note length'), tr(`${limits.maxNoteLength.toLocaleString(locale)} caractères`, `${limits.maxNoteLength.toLocaleString(locale)} characters`)],
    [tr('Longueur d’une URL', 'URL length'), tr(`${limits.maxUrlLength.toLocaleString(locale)} caractères`, `${limits.maxUrlLength.toLocaleString(locale)} characters`)],
    [tr('Taille du coffre chiffré', 'Encrypted vault size'), `${Math.round(limits.maxVaultBytes / 1048576)} ${tr('Mo', 'MB')}`]
  ];

  const box = app.openModal(`
    <div class="modal-header">
      <div class="modal-title">${tr('Compte', 'Account')}</div>
      <button class="modal-close">${GEN_ICONS.close}</button>
    </div>
    <div class="modal-body">
      <div class="account-summary">
        <div class="account-avatar" data-account-avatar>${app.avatarSrc ? `<img src="${app.escapeHtml(app.avatarSrc)}" alt="" referrerpolicy="no-referrer">` : app.escapeHtml(account.email.charAt(0).toUpperCase())}</div>
        <div class="account-summary-text">
          <div class="account-email">${app.escapeHtml(account.email)}</div>
          <div class="account-meta">${isCloud
            ? `${tr('Synchronisé avec', 'Synced with')} ${app.escapeHtml(account.serverUrl ?? '')}`
            : tr('Stocké uniquement sur cet appareil', 'Stored on app device only')}</div>
        </div>
      </div>

      <div class="tab-btn-group account-tabs" role="tablist">
        <button type="button" class="tab-btn active" role="tab" aria-selected="true" data-account-tab="general">${tabIcon('general')}<span>${tr('Général', 'General')}</span></button>
        <button type="button" class="tab-btn" role="tab" aria-selected="false" data-account-tab="security">${tabIcon('security')}<span>${tr('Sécurité', 'Security')}</span></button>
        ${isCloud ? `<button type="button" class="tab-btn" role="tab" aria-selected="false" data-account-tab="sessions">${tabIcon('sessions')}<span>${tr('Sessions', 'Sessions')}</span></button>` : ''}
        <button type="button" class="tab-btn" role="tab" aria-selected="false" data-account-tab="plan">${tabIcon('storage')}<span>${isCloud ? tr('Espace', 'Storage') : tr('Limites', 'Limits')}</span></button>
        <button type="button" class="tab-btn" role="tab" aria-selected="false" data-account-tab="data">${tabIcon('data')}<span>${tr('Données', 'Data')}</span></button>
      </div>

      <div data-tab-panel="general">
      ${isCloud ? `
        <div class="account-sync-row">
          <div style="min-width:0;">
            <div class="form-label">${tr('Synchronisation', 'Sync')}</div>
            <div class="account-sync-state" data-sync-state></div>
          </div>
          <button class="btn-primary" data-action="sync">${GEN_ICONS.refresh}<span>${tr('Synchroniser', 'Sync now')}</span></button>
        </div>
        <div class="form-section" data-reauth hidden>
          <div class="form-section-title">${tr('Session expirée', 'Session expired')}</div>
          <p class="modal-text">${tr('Saisissez un code de votre application d’authentification pour reprendre la synchronisation.', 'Enter a code from your authenticator app to resume syncing.')}</p>
          <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
            <input class="form-input otp-input" data-reauth-code inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
            <button class="btn-primary btn-accent" data-action="reauth">${tr('Reprendre', 'Resume')}</button>
          </div>
          <div class="form-error" data-error="reauth" role="alert" hidden></div>
        </div>` : `
        <section class="account-section">
          <h3 class="account-section-title">${tr('Activer la synchronisation', 'Enable sync')}</h3>
          <p class="modal-text">${tr('Le coffre est envoyé chiffré. Le mot de passe principal ne quitte jamais cet appareil.', 'The vault is uploaded encrypted. The master password never leaves app device.')}</p>
          <div class="form-field">
            <label class="form-label" for="account-server">${tr('Adresse du serveur', 'Server address')}</label>
            <input class="form-input" id="account-server" type="url" value="${app.escapeHtml(DEFAULT_SERVER_URL)}" autocomplete="url" spellcheck="false">
          </div>
          <div class="form-field">
            <label class="form-label" for="account-connect-password">${tr('Mot de passe principal', 'Master password')}</label>
            <input class="form-input" id="account-connect-password" type="password" autocomplete="current-password">
          </div>
          <div class="form-error" data-error="connect" role="alert" hidden></div>
          <div class="account-actions account-actions-end">
            <button class="btn-primary btn-accent" data-action="connect">${tr('Activer', 'Enable')}</button>
          </div>
        </section>`}

      <section class="account-section" data-profile-section>
        <h3 class="account-section-title">${tr('Photo de profil', 'Profile picture')}</h3>
        <div class="profile-row">
          <div class="account-avatar large" data-profile-preview>${app.escapeHtml(account.email.charAt(0).toUpperCase())}</div>
          <div class="profile-controls" data-profile-controls><span class="skeleton skeleton-line" style="width:60%"></span></div>
        </div>
        <div class="form-error" data-error="avatar" role="alert" hidden></div>
      </section>

      <section class="account-section" data-device-section hidden></section>

      <section class="account-section">
        <h3 class="account-section-title">${tr('Session sur cet appareil', 'Session on app device')}</h3>
        <div class="account-actions">
          <button class="btn-primary" data-action="lock">${tr('Verrouiller', 'Lock')}</button>
          <button class="btn-primary btn-ghost" data-action="signout">${tr('Se déconnecter de cet appareil', 'Sign out of app device')}</button>
        </div>
      </section>
      <section class="account-section">
        <h3 class="account-section-title">${tr('Apparence', 'Appearance')}</h3>
        <p class="modal-text">${tr('Thème actuel', 'Current theme')} : <strong data-theme-name></strong></p>
        <div class="theme-presets">
          ${PRESET_THEMES.map((t, i) => `<button type="button" class="theme-preset" data-theme-preset="${i}" style="--p-bg:${t.colors['bg-primary']};--p-fg:${t.colors['text-primary']};--p-accent:${t.colors.accent}"><span class="theme-swatch"></span>${app.escapeHtml(t.name)}</button>`).join('')}
        </div>
        <div class="account-actions">
          <button type="button" class="btn-primary" data-action="theme-import">${tr('Importer un thème', 'Import a theme')}</button>
          <button type="button" class="btn-primary btn-ghost" data-action="theme-template">${tr('Télécharger le modèle', 'Download the template')}</button>
          <button type="button" class="btn-primary btn-ghost" data-action="theme-reset">${tr('Thème par défaut', 'Default theme')}</button>
        </div>
        <input type="file" accept="application/json,.json" hidden data-theme-file>
        <div class="form-error" data-theme-error hidden></div>
      </section>
      </div>

      <div data-tab-panel="security" hidden>
      <section class="account-section">
        <h3 class="account-section-title">${tr('Sécurité du compte', 'Account security')}</h3>
        ${isCloud ? `
          <div class="switch-row" style="cursor:default;">
            <span>${tr('Double authentification', 'Two-factor authentication')}<small>${tr('Un code de votre application (Aegis, Google Authenticator, 2FAS…) est demandé à chaque connexion', 'A code from your app (Aegis, Google Authenticator, 2FAS…) is required at every sign-in')}</small></span>
            <span class="status-pill" data-totp-status>…</span>
          </div>
          <div class="account-actions account-actions-end"><button class="btn-primary" data-action="totp" disabled>${tr('Configurer', 'Set up')}</button></div>
          <div class="form-section" data-totp-flow hidden></div>
          <div data-security-keys>${securityKeysSectionHtml(tr)}</div>` : `
          <p class="modal-text">${tr('La double authentification protège la connexion au serveur : activez d’abord la synchronisation.', 'Two-factor authentication protects the server sign-in: enable sync first.')}</p>`}
        <div class="switch-row" style="cursor:default;">
          <span>${tr('Clé de secours', 'Recovery key')}<small>${tr('Permet de choisir un nouveau mot de passe principal sans perdre le coffre', 'Lets you set a new master password without losing the vault')}</small></span>
          <span class="status-pill ${hasRecovery ? 'on' : 'off'}">${hasRecovery ? tr('Créée', 'Created') : tr('Aucune', 'None')}</span>
        </div>
        <div class="account-actions account-actions-end"><button class="btn-primary" data-action="recovery">${hasRecovery ? tr('Créer une nouvelle clé', 'Create a new key') : tr('Créer une clé', 'Create a key')}</button></div>
        <div class="form-section" data-recovery-flow hidden>
          ${hasRecovery ? `<p class="modal-text">${tr('L’ancienne clé cessera de fonctionner.', 'The previous key will stop working.')}</p>` : ''}
          <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
            <input class="form-input" type="password" data-recovery-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
            <button class="btn-primary btn-accent" data-action="recovery-create">${tr('Créer', 'Create')}</button>
          </div>
          <div class="form-error" data-error="recovery" role="alert" hidden></div>
        </div>
      </section>

      <section class="account-section">
        <h3 class="account-section-title">${tr('Changer le mot de passe principal', 'Change master password')}</h3>
        <div class="form-field">
          <label class="form-label" for="account-current-password">${tr('Mot de passe actuel', 'Current password')}</label>
          <input class="form-input" id="account-current-password" type="password" autocomplete="current-password">
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label" for="account-new-password">${tr('Nouveau mot de passe', 'New password')}</label>
            <input class="form-input" id="account-new-password" type="password" autocomplete="new-password">
          </div>
          <div class="form-field">
            <label class="form-label" for="account-new-password-confirm">${tr('Confirmer', 'Confirm')}</label>
            <input class="form-input" id="account-new-password-confirm" type="password" autocomplete="new-password">
          </div>
        </div>
        <div class="form-error" data-error="password" role="alert" hidden></div>
        <div class="account-actions account-actions-end">
          <button class="btn-primary" data-action="change-password">${tr('Changer le mot de passe', 'Change password')}</button>
        </div>
      </section>
      </div>

      ${isCloud ? `
      <div data-tab-panel="sessions" hidden>
        <section class="account-section">
          <div class="account-section-head">
            <h3 class="account-section-title">${tr('Appareils connectés', 'Signed-in devices')}</h3>
            <button class="btn-primary btn-ghost btn-sm" data-action="sessions-refresh">${GEN_ICONS.refresh}<span>${tr('Actualiser', 'Refresh')}</span></button>
          </div>
          <p class="modal-text">${tr('Adresse IP tronquée et lieu approximatif, calculés par votre serveur. Fermer une session déconnecte l’appareil au prochain échange avec le serveur.', 'Truncated IP address and approximate place, computed by your server. Closing a session signs the device out the next time it talks to the server.')}</p>
          <div class="session-list" data-session-list></div>
          <div class="form-section session-confirm" data-session-confirm hidden></div>
        </section>
      </div>` : ''}

      <div data-tab-panel="plan" hidden>
        ${isCloud ? `<section class="account-section" data-billing-section>
          <h3 class="account-section-title">${tr('Espace de stockage', 'Storage')}</h3>
          <div data-usage></div>
          <div data-plans></div>
        </section>` : ''}
        <section class="account-section">
          <h3 class="account-section-title">${isCloud ? tr('Limites du compte', 'Account limits') : tr('Limites', 'Limits')}</h3>
          <div class="limit-grid" data-limit-grid>
            ${limitRows.map(([label, value]) => `<span>${label}</span><span>${value}</span>`).join('')}
          </div>
        </section>
      </div>

      <div data-tab-panel="data" hidden>
      <section class="account-section">
        <h3 class="account-section-title">${tr('Confidentialité', 'Privacy')}</h3>
        <p class="modal-text">${isCloud
          ? tr('Le serveur ne reçoit que des données chiffrées sur cet appareil : il ne peut lire ni vos identifiants, ni vos notes, ni vos fichiers.', 'The server only receives data encrypted on app device: it cannot read your credentials, notes or files.')
          : tr('Rien ne quitte cet appareil.', 'Nothing leaves app device.')}</p>
        <div class="legal-links" data-legal-links></div>
        <div class="account-actions">
          <button class="btn-primary" data-action="export">${tr('Exporter mes données', 'Export my data')}</button>
        </div>
      </section>

      <section class="account-section account-danger">
        <h3 class="account-section-title">${tr('Effacer mes données', 'Erase my data')}</h3>
        <p class="modal-text">${tr('Choisissez ce qui part. Une sauvegarde vous est proposée avant, et l’effacement n’a lieu qu’une fois le fichier obtenu.', 'Pick what goes. A backup is offered first, and nothing is erased until the file is in your hands.')}</p>
        <div class="account-actions account-actions-end">
          <button class="btn-primary btn-danger" data-action="erase">${tr('Effacer mes données…', 'Erase my data…')}</button>
        </div>
      </section>

      ${isCloud ? `
        <section class="account-section account-danger">
          <h3 class="account-section-title">${tr('Supprimer le compte en ligne', 'Delete online account')}</h3>
          <p class="modal-text">${tr('Supprime le coffre du serveur. Les données restent sur cet appareil.', 'Deletes the vault from the server. Data stays on app device.')}</p>
          <div class="form-field">
            <label class="form-label" for="account-delete-password">${tr('Mot de passe principal', 'Master password')}</label>
            <input class="form-input" id="account-delete-password" type="password" autocomplete="current-password">
          </div>
          <div class="form-error" data-error="delete" role="alert" hidden></div>
          <div class="account-actions account-actions-end">
            <button class="btn-primary btn-danger" data-action="delete">${tr('Supprimer le compte en ligne', 'Delete online account')}</button>
          </div>
        </section>` : ''}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary" data-close>${tr('Fermer', 'Close')}</button>
    </div>
  `);

  const $ = <T extends HTMLElement>(selector: string) => box.querySelector(selector) as T | null;
  box.classList.add('account-modal');

  const loaded = new Set<string>();
  const selectTab = (name: string) => {
    box.querySelectorAll<HTMLElement>('[data-account-tab]').forEach(tab => {
      const active = tab.dataset.accountTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    box.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach(panel => { panel.hidden = panel.dataset.tabPanel !== name; });
    if (loaded.has(name)) return;
    loaded.add(name);
    if (name === 'sessions') void loadSessions();
    if (name === 'plan' && isCloud) void loadBilling();
    if (name === 'data') void loadLegal();
  };
  box.querySelectorAll<HTMLElement>('[data-account-tab]').forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.accountTab!)));

  const renderState = () => {
    const el = $('[data-sync-state]');
    if (!el) return;
    const state = accountService.getSyncState();
    const when = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString(locale) : tr('jamais', 'never');
    el.textContent = `${app.syncStatusLabel(state.status)} · ${tr('dernière synchro', 'last sync')} ${when}${state.message ? ` · ${translateError(state.message, i18n.getLocale())}` : ''}`;
    const reauth = $('[data-reauth]');
    if (reauth) reauth.hidden = state.code !== 'totp_required';
  };
  renderState();
  const unsubscribe = accountService.onSyncStateChange(() => {
    if (!box.isConnected) return unsubscribe();
    renderState();
  });

  const showError = (key: string, err: unknown) => {
    const el = $(`[data-error="${key}"]`);
    if (!el) return;
    el.textContent = accountErrorMessage(err);
    el.hidden = false;
  };
  const hideError = (key: string) => {
    const el = $(`[data-error="${key}"]`);
    if (el) el.hidden = true;
  };
  const runBusy = async (button: HTMLButtonElement, busyLabel: string, task: () => Promise<void>) => {
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await task();
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  };
  const action = (name: string) => $<HTMLButtonElement>(`[data-action="${name}"]`);

  action('sync')?.addEventListener('click', event => {
    void runBusy(event.currentTarget as HTMLButtonElement, tr('Synchronisation…', 'Syncing…'), () => accountService.syncNow());
  });

  action('reauth')?.addEventListener('click', event => {
    const code = ($<HTMLInputElement>('[data-reauth-code]')?.value ?? '').trim();
    hideError('reauth');
    void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
      try {
        await accountService.reauthenticate(code);
      } catch (err) {
        showError('reauth', err);
      }
    });
  });

  action('connect')?.addEventListener('click', event => {
    const password = ($<HTMLInputElement>('#account-connect-password')?.value ?? '');
    const serverUrl = ($<HTMLInputElement>('#account-server')?.value ?? '');
    hideError('connect');
    if (!password) return showError('connect', new Error(tr('Saisissez le mot de passe principal', 'Enter the master password')));
    void runBusy(event.currentTarget as HTMLButtonElement, tr('Envoi du coffre chiffré…', 'Uploading encrypted vault…'), async () => {
      try {
        const { recoveryKey } = await accountService.connectCloud(serverUrl, password);
        app.renderSyncStatus();
        app.showRecoveryKey(recoveryKey, tr('La synchronisation est active. Voici la clé de secours de ce compte : elle permet de retrouver l’accès si vous oubliez votre mot de passe principal.', 'Sync is on. Here is app account’s recovery key: it lets you get back in if you forget your master password.'));
      } catch (err) {
        showError('connect', err);
      }
    });
  });

  // Apparence : thèmes intégrés, thème importé, modèle à modifier
  const themeName = $('[data-theme-name]');
  const themeError = $('[data-theme-error]');
  const paintThemeName = () => {
    if (themeName) themeName.textContent = loadSavedTheme()?.name ?? tr('BetterVault (clair ou sombre)', 'BetterVault (light or dark)');
  };
  const useTheme = (theme: ReturnType<typeof loadSavedTheme>) => {
    saveTheme(theme);
    app.updateThemeIcons();
    paintThemeName();
    if (themeError) themeError.hidden = true;
  };
  paintThemeName();
  box.querySelectorAll<HTMLButtonElement>('[data-theme-preset]').forEach(button => button.addEventListener('click', () => {
    useTheme(PRESET_THEMES[Number(button.dataset.themePreset)]);
  }));
  action('theme-reset')?.addEventListener('click', () => useTheme(null));
  action('theme-template')?.addEventListener('click', () => {
    downloadExportFile(themeTemplate(), 'bettervault-theme.json', 'application/json');
  });
  const themeFile = $<HTMLInputElement>('[data-theme-file]');
  action('theme-import')?.addEventListener('click', () => themeFile?.click());
  themeFile?.addEventListener('change', async () => {
    const file = themeFile.files?.[0];
    themeFile.value = '';
    if (!file) return;
    try {
      if (file.size > 16_384) throw new ThemeError('Fichier trop volumineux pour un thème');
      useTheme(parseTheme(JSON.parse(await file.text())));
      app.showToast(tr('Thème appliqué', 'Theme applied'), 'success');
    } catch (err) {
      if (themeError) {
        themeError.textContent = err instanceof ThemeError ? translateError(err.message, i18n.getLocale()) : tr('Fichier illisible', 'Unreadable file');
        themeError.hidden = false;
      }
    }
  });

  const keysRoot = $<HTMLElement>('[data-security-keys]');
  if (keysRoot) wireSecurityKeys(keysRoot, {
    list: () => accountService.listSecurityKeys(),
    add: (password, name, kind) => accountService.addSecurityKey(password, name, kind),
    remove: (password, id) => accountService.removeSecurityKey(password, id),
    tr,
    escape: value => app.escapeHtml(value),
    errorMessage: accountErrorMessage,
    toast: (message, kind) => app.showToast(message, kind),
    locale
  });

  // Double authentification du compte
  const totpButton = action('totp');
  const totpStatus = $('[data-totp-status]');
  const totpFlow = $('[data-totp-flow]');
  let totpEnabled = false;
  const renderTotpStatus = () => {
    if (!totpStatus || !totpButton) return;
    totpStatus.className = `status-pill ${totpEnabled ? 'on' : 'off'}`;
    totpStatus.textContent = totpEnabled ? tr('Activée', 'On') : tr('Désactivée', 'Off');
    totpButton.textContent = totpEnabled ? tr('Désactiver', 'Turn off') : tr('Activer', 'Turn on');
    totpButton.disabled = false;
  };
  if (isCloud && totpStatus) {
    accountService.getCloudAccountInfo().then(info => {
      if (!box.isConnected) return;
      totpEnabled = info.totpEnabled;
      renderTotpStatus();
    }).catch(() => {
      if (totpStatus.isConnected) totpStatus.textContent = tr('Serveur injoignable', 'Server unreachable');
    });
  }

  totpButton?.addEventListener('click', () => {
    if (!totpFlow) return;
    if (!totpFlow.hidden) {
      totpFlow.hidden = true;
      return;
    }
    totpFlow.hidden = false;
    if (totpEnabled) {
      totpFlow.innerHTML = `
        <p class="modal-text">${tr('Confirmez avec votre mot de passe principal et un code de l’application.', 'Confirm with your master password and a code from the app.')}</p>
        <div class="form-row">
          <input class="form-input" type="password" data-totp-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
          <input class="form-input otp-input" data-totp-code inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
        </div>
        <div class="form-error" data-error="totp" role="alert" hidden></div>
        <div class="account-actions account-actions-end"><button class="btn-primary btn-danger" data-totp-disable>${tr('Désactiver', 'Turn off')}</button></div>`;
      totpFlow.querySelector<HTMLButtonElement>('[data-totp-disable]')?.addEventListener('click', event => {
        hideError('totp');
        const password = totpFlow.querySelector<HTMLInputElement>('[data-totp-password]')!.value;
        const code = totpFlow.querySelector<HTMLInputElement>('[data-totp-code]')!.value;
        void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
          try {
            await accountService.disableTotp(password, code);
            totpEnabled = false;
            totpFlow.hidden = true;
            renderTotpStatus();
            app.showToast(tr('Double authentification désactivée', 'Two-factor authentication turned off'), 'info');
          } catch (err) {
            showError('totp', err);
          }
        });
      });
      totpFlow.querySelector<HTMLInputElement>('[data-totp-password]')?.focus();
      return;
    }

    totpFlow.innerHTML = `
      <p class="modal-text">${tr('Confirmez avec votre mot de passe principal pour afficher le QR code.', 'Confirm with your master password to show the QR code.')}</p>
      <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
        <input class="form-input" type="password" data-totp-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
        <button class="btn-primary btn-accent" data-totp-start>${tr('Continuer', 'Continue')}</button>
      </div>
      <div class="form-error" data-error="totp" role="alert" hidden></div>`;
    const passwordInput = totpFlow.querySelector<HTMLInputElement>('[data-totp-password]')!;
    passwordInput.focus();
    totpFlow.querySelector<HTMLButtonElement>('[data-totp-start]')?.addEventListener('click', event => {
      hideError('totp');
      void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
        try {
          const setup = await accountService.beginTotpSetup(passwordInput.value);
          totpFlow.innerHTML = `
            <div class="totp-setup">
              <div class="qr-box" aria-label="QR code">${renderSVG(setup.uri, { border: 1 })}</div>
              <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
                <ol class="ie-steps">
                  <li>${tr('Scannez le QR code avec votre application d’authentification', 'Scan the QR code with your authenticator app')}</li>
                  <li>${tr('Saisissez le code à 6 chiffres qu’elle affiche', 'Enter the 6-digit code it shows')}</li>
                </ol>
                <input class="form-input otp-input" data-totp-code inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
                <div class="form-error" data-error="totp" role="alert" hidden></div>
                <button class="btn-primary btn-accent" data-totp-enable style="justify-content:center;">${tr('Activer', 'Turn on')}</button>
                <div class="secret-card compact">
                  <div class="secret-card-head">
                    <span class="secret-card-label">${tr('Clé de configuration', 'Setup key')}</span>
                    <button class="btn-primary btn-ghost btn-sm" data-totp-copy>${GEN_ICONS.copy}<span>${tr('Copier', 'Copy')}</span></button>
                  </div>
                  ${secretGridHtml(setup.secret, { numbered: false })}
                </div>
              </div>
            </div>`;
          const codeInput = totpFlow.querySelector<HTMLInputElement>('[data-totp-code]')!;
          codeInput.focus();
          totpFlow.querySelector('[data-totp-copy]')?.addEventListener('click', () => {
            void app.copyToClipboardWithAutoClear(setup.secret, tr('Clé copiée', 'Key copied'), true);
          });
          totpFlow.querySelector<HTMLButtonElement>('[data-totp-enable]')?.addEventListener('click', enableEvent => {
            hideError('totp');
            void runBusy(enableEvent.currentTarget as HTMLButtonElement, '…', async () => {
              try {
                await accountService.enableTotp(codeInput.value);
                totpEnabled = true;
                totpFlow.hidden = true;
                renderTotpStatus();
                app.showToast(tr('Double authentification activée', 'Two-factor authentication turned on'), 'success');
              } catch (err) {
                showError('totp', err);
              }
            });
          });
        } catch (err) {
          showError('totp', err);
        }
      });
    });
  });

  // Clé de secours
  const recoveryFlow = $('[data-recovery-flow]');
  action('recovery')?.addEventListener('click', () => {
    if (!recoveryFlow) return;
    recoveryFlow.hidden = !recoveryFlow.hidden;
    if (!recoveryFlow.hidden) $<HTMLInputElement>('[data-recovery-password]')?.focus();
  });
  action('recovery-create')?.addEventListener('click', event => {
    hideError('recovery');
    const password = $<HTMLInputElement>('[data-recovery-password]')?.value ?? '';
    void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
      try {
        const key = await accountService.regenerateRecoveryKey(password);
        app.showRecoveryKey(key, tr('Voici votre nouvelle clé de secours. L’ancienne ne fonctionne plus.', 'Here is your new recovery key. The previous one no longer works.'));
      } catch (err) {
        showError('recovery', err);
      }
    });
  });

  // Photo de profil : envoi ou lien selon ce que le serveur autorise
  const profileControls = $('[data-profile-controls]');
  const renderAvatarInto = (el: HTMLElement | null, src: string | null) => {
    if (!el) return;
    el.classList.toggle('has-image', !!src);
    el.innerHTML = src
      ? `<img src="${app.escapeHtml(src)}" alt="" referrerpolicy="no-referrer">`
      : app.escapeHtml(account.email.charAt(0).toUpperCase());
  };
  const refreshAvatar = async () => {
    try {
      app.avatarSrc = await accountService.getAvatarSource();
    } catch {
      app.avatarSrc = null;
    }
    box.querySelectorAll<HTMLElement>('[data-account-avatar], [data-profile-preview]').forEach(el => renderAvatarInto(el, app.avatarSrc));
    app.renderSyncStatus();
    const remove = box.querySelector<HTMLButtonElement>('[data-avatar-remove]');
    if (remove) remove.hidden = !app.avatarSrc;
  };
  if (profileControls) {
    void accountService.getAvatarPolicy().then(policy => {
      if (!box.isConnected) return;
      const kb = Math.round(policy.maxBytes / 1024);
      if (!policy.uploads && !policy.remoteUrls) {
        profileControls.innerHTML = `<p class="field-hint">${tr('Ce serveur ne permet pas d’ajouter une photo de profil.', 'This server does not allow profile pictures.')}</p>`;
        return;
      }
      profileControls.innerHTML = `
        <div class="account-actions">
          ${policy.uploads ? `<label class="btn-primary" style="cursor:pointer;">${tr('Choisir une image', 'Choose an image')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" data-avatar-file hidden></label>` : ''}
          <button type="button" class="btn-primary btn-ghost" data-avatar-remove hidden>${tr('Retirer', 'Remove')}</button>
        </div>
        ${policy.uploads ? `<span class="field-hint">${isCloud
          ? tr(`Recadrée et réduite sur cet appareil (${kb} Ko max. sur ce serveur). Visible par vous uniquement.`, `Cropped and resized on app device (${kb} KB max on app server). Visible to you only.`)
          : tr('Gardée sur cet appareil uniquement.', 'Kept on app device only.')}</span>` : ''}
        ${policy.remoteUrls ? `
          <div class="form-row row-wrap">
            <input class="form-input" type="url" data-avatar-url placeholder="https://…/photo.png" autocomplete="off" spellcheck="false">
            <button type="button" class="btn-primary" data-avatar-link>${tr('Utiliser ce lien', 'Use app link')}</button>
          </div>
          <span class="field-hint">${tr('Le site qui héberge l’image voit votre adresse IP quand elle s’affiche.', 'The site hosting the image sees your IP address when it is displayed.')}</span>` : ''}`;

      profileControls.querySelector<HTMLInputElement>('[data-avatar-file]')?.addEventListener('change', async event => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        hideError('avatar');
        try {
          const { bytes, dataUrl } = await resizeAvatar(file);
          if (isCloud && bytes.length > policy.maxBytes) throw new Error(tr(`Image trop lourde après réduction (${kb} Ko max.)`, `Image too large after resizing (${kb} KB max)`));
          await accountService.setAvatarImage(bytes, dataUrl);
          await refreshAvatar();
          app.showToast(tr('Photo de profil mise à jour', 'Profile picture updated'), 'success');
        } catch (err) {
          showError('avatar', err);
        }
      });
      profileControls.querySelector<HTMLButtonElement>('[data-avatar-link]')?.addEventListener('click', event => {
        const url = profileControls.querySelector<HTMLInputElement>('[data-avatar-url]')?.value ?? '';
        hideError('avatar');
        void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
          try {
            await accountService.setAvatarUrl(url);
            await refreshAvatar();
          } catch (err) {
            showError('avatar', err);
          }
        });
      });
      profileControls.querySelector<HTMLButtonElement>('[data-avatar-remove]')?.addEventListener('click', event => {
        hideError('avatar');
        void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
          try {
            await accountService.removeAvatar();
            await refreshAvatar();
          } catch (err) {
            showError('avatar', err);
          }
        });
      });
      void refreshAvatar();
    });
  }

  void app.bindDeviceSection(box.querySelector('[data-device-section]') as HTMLElement);

  action('change-password')?.addEventListener('click', event => {
    const value = (id: string) => ($<HTMLInputElement>(`#${id}`)?.value ?? '');
    hideError('password');
    if (!value('account-current-password')) return showError('password', new Error(tr('Saisissez le mot de passe actuel', 'Enter the current password')));
    if (value('account-new-password') !== value('account-new-password-confirm')) {
      return showError('password', new Error(tr('Les deux nouveaux mots de passe sont différents', 'The two new passwords are different')));
    }
    void runBusy(event.currentTarget as HTMLButtonElement, tr('Changement…', 'Changing…'), async () => {
      try {
        await accountService.changeMasterPassword(value('account-current-password'), value('account-new-password'));
        box.querySelectorAll<HTMLInputElement>('#account-current-password, #account-new-password, #account-new-password-confirm').forEach(input => { input.value = ''; });
        app.showToast(tr('Mot de passe principal changé', 'Master password changed'), 'success', 4000);
      } catch (err) {
        showError('password', err);
      }
    });
  });

  action('lock')?.addEventListener('click', () => app.lockApp());
  action('signout')?.addEventListener('click', () => void app.signOutDevice());
  action('export')?.addEventListener('click', () => {
    app.closeModal();
    document.getElementById('btn-open-import')?.click();
  });

  action('erase')?.addEventListener('click', () => {
    app.closeModal();
    app.openEraseModal();
  });

  // Sessions : liste, fermeture avec mot de passe (et code 2FA si activée)
  const sessionList = $('[data-session-list]');
  const sessionConfirm = $('[data-session-confirm]');
  const skeletonRows = (count: number) => Array.from({ length: count }, () => `
    <div class="session-row"><span class="skeleton skeleton-circle"></span><div class="session-main"><span class="skeleton skeleton-line" style="width:55%"></span><span class="skeleton skeleton-line" style="width:80%"></span></div></div>`).join('');
  const flag = (country: string | null) => country && /^[A-Z]{2}$/.test(country)
    ? String.fromCodePoint(...[...country].map(c => 0x1f1a5 + c.charCodeAt(0)))
    : '';
  const regionName = (country: string | null) => {
    if (!country) return '';
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country;
    } catch {
      return country;
    }
  };
  const relative = (at: number) => {
    const diff = Date.now() - at;
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (diff < 60_000) return tr('à l’instant', 'just now');
    if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), 'minute');
    if (diff < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), 'hour');
    return rtf.format(-Math.round(diff / 86_400_000), 'day');
  };
  const deviceIcon = (device: string | null) => /Android|iOS/.test(device ?? '')
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';

  let sessions: AccountSession[] = [];
  const renderSessions = () => {
    if (!sessionList) return;
    const others = sessions.filter(s => !s.current).length;
    sessionList.innerHTML = sessions.map(s => {
      const place = [s.city, regionName(s.country)].filter(Boolean).join(', ');
      return `
        <div class="session-row ${s.current ? 'current' : ''}">
          <span class="session-icon">${deviceIcon(s.device)}</span>
          <div class="session-main">
            <div class="session-title">${app.escapeHtml(s.device ?? tr('Appareil inconnu', 'Unknown device'))}${s.current ? `<span class="status-pill on">${tr('Cet appareil', 'This device')}</span>` : ''}</div>
            <div class="session-meta">
              ${place ? `<span>${flag(s.country)} ${app.escapeHtml(place)}</span>` : `<span>${tr('Lieu inconnu', 'Unknown place')}</span>`}
              ${s.ipPrefix ? `<span class="mono">${app.escapeHtml(s.ipPrefix)}</span>` : ''}
              <span title="${new Date(s.lastSeenAt).toLocaleString(locale)}">${tr('Actif', 'Active')} ${relative(s.lastSeenAt)}</span>
              <span>${tr('Connecté le', 'Signed in')} ${new Date(s.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
          </div>
          ${s.current ? '' : `<button class="btn-primary btn-ghost btn-sm" data-revoke="${s.id}">${tr('Fermer', 'Close')}</button>`}
        </div>`;
    }).join('') + (others > 1 ? `
      <div class="account-actions account-actions-end"><button class="btn-primary btn-danger btn-sm" data-revoke="all">${tr(`Fermer les ${others} autres sessions`, `Close the ${others} other sessions`)}</button></div>` : '');
  };
  const loadSessions = async () => {
    if (!sessionList) return;
    sessionList.innerHTML = skeletonRows(2);
    try {
      sessions = await accountService.listSessions();
      if (box.isConnected) renderSessions();
    } catch (err) {
      sessionList.innerHTML = `<div class="form-error">${app.escapeHtml(accountErrorMessage(err))}</div>`;
    }
  };
  action('sessions-refresh')?.addEventListener('click', () => void loadSessions());

  sessionList?.addEventListener('click', e => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-revoke]')?.dataset.revoke;
    if (!target || !sessionConfirm) return;
    const session = sessions.find(s => s.id === target);
    sessionConfirm.hidden = false;
    sessionConfirm.innerHTML = `
      <p class="modal-text"><strong>${target === 'all'
        ? tr('Fermer toutes les autres sessions', 'Close all other sessions')
        : `${tr('Fermer la session', 'Close session')} « ${app.escapeHtml(session?.device ?? '')} »`}</strong><br>${tr('Confirmez avec votre mot de passe principal', 'Confirm with your master password')}${totpEnabled ? tr(' et un code de l’application d’authentification.', ' and a code from your authenticator app.') : '.'}</p>
      <div class="form-row" style="grid-template-columns:${totpEnabled ? 'minmax(0,1fr) 120px' : 'minmax(0,1fr)'};">
        <input class="form-input" type="password" data-revoke-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
        ${totpEnabled ? '<input class="form-input otp-input" data-revoke-code inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">' : ''}
      </div>
      <div class="form-error" data-error="revoke" role="alert" hidden></div>
      <div class="account-actions account-actions-end">
        <button class="btn-primary btn-ghost" data-revoke-cancel>${tr('Annuler', 'Cancel')}</button>
        <button class="btn-primary btn-danger" data-revoke-confirm>${tr('Fermer', 'Close')}</button>
      </div>`;
    const passwordInput = sessionConfirm.querySelector<HTMLInputElement>('[data-revoke-password]')!;
    passwordInput.focus();
    sessionConfirm.querySelector('[data-revoke-cancel]')?.addEventListener('click', () => { sessionConfirm.hidden = true; });
    const submit = (button: HTMLButtonElement) => {
      hideError('revoke');
      const code = sessionConfirm.querySelector<HTMLInputElement>('[data-revoke-code]')?.value;
      void runBusy(button, '…', async () => {
        try {
          const count = await accountService.revokeSessions(passwordInput.value, target === 'all' ? { all: true } : { sessionId: target }, code);
          sessionConfirm.hidden = true;
          app.showToast(count > 1 ? tr(`${count} sessions fermées`, `${count} sessions closed`) : tr('Session fermée', 'Session closed'), 'success');
          await loadSessions();
        } catch (err) {
          showError('revoke', err);
        }
      });
    };
    const confirmButton = sessionConfirm.querySelector<HTMLButtonElement>('[data-revoke-confirm]')!;
    confirmButton.addEventListener('click', () => submit(confirmButton));
    sessionConfirm.addEventListener('keydown', ev => { if ((ev as KeyboardEvent).key === 'Enter') submit(confirmButton); });
  });

  // Espace de stockage et offres du serveur
  const loadBilling = async () => {
    const usageEl = $('[data-usage]');
    const plansEl = $('[data-plans]');
    if (!usageEl || !plansEl) return;
    usageEl.innerHTML = '<span class="skeleton skeleton-line" style="width:60%"></span><span class="skeleton skeleton-bar"></span>';
    try {
      const [billing, usage] = await Promise.all([accountService.getBilling(), accountService.getAttachmentUsage().catch(() => null)]);
      if (!box.isConnected) return;
      const mb = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toLocaleString(locale, { maximumFractionDigits: 1 })} ${tr('Go', 'GB')}` : `${Math.round(bytes / 1048576).toLocaleString(locale)} ${tr('Mo', 'MB')}`;
      usageEl.innerHTML = usage?.enabled ? `
        <div class="usage-head"><span>${tr('Pièces jointes', 'Attachments')}</span><span class="mono">${mb(usage.usedBytes)} / ${mb(usage.quotaBytes)}</span></div>
        <div class="usage-bar"><span style="width:${Math.min(100, (usage.usedBytes / Math.max(1, usage.quotaBytes)) * 100).toFixed(1)}%"></span></div>` : `<p class="modal-text">${tr('Pièces jointes désactivées sur ce serveur.', 'Attachments are disabled on app server.')}</p>`;
      const grid = $('[data-limit-grid]');
      if (grid) {
        const l = billing.limits;
        grid.innerHTML = ([
          [tr('Coffres', 'Vaults'), l.maxVaults.toLocaleString(locale)],
          [tr('Identifiants par coffre', 'Credentials per vault'), l.maxCredentialsPerVault.toLocaleString(locale)],
          [tr('Taille du coffre chiffré', 'Encrypted vault size'), mb(l.maxVaultBytes)],
          [tr('Taille d’un fichier', 'File size'), mb(l.maxAttachmentBytes ?? 0)],
          [tr('Espace des pièces jointes', 'Attachment storage'), mb(l.attachmentQuotaBytes ?? 0)],
          [tr('Longueur d’une note', 'Note length'), l.maxNoteLength.toLocaleString(locale)]
        ] as Array<[string, string]>).map(([label, value]) => `<span>${label}</span><span>${value}</span>`).join('');
      }
      if (!billing.enabled || billing.plans.length === 0) {
        plansEl.innerHTML = '';
        return;
      }
      const sub = billing.subscription;
      const boostLabel = (key: string, value: number) => ({
        attachmentQuotaBytes: `+${mb(value)} ${tr('de pièces jointes', 'attachment storage')}`,
        maxAttachmentBytes: `+${mb(value)} ${tr('par fichier', 'per file')}`,
        maxVaultBytes: `+${mb(value)} ${tr('par coffre', 'per vault')}`,
        maxVaults: `+${value} ${tr('coffres', 'vaults')}`,
        maxCredentialsPerVault: `+${value.toLocaleString(locale)} ${tr('identifiants par coffre', 'credentials per vault')}`
      } as Record<string, string>)[key] ?? '';
      // État de l'abonnement en cours : ce qui est payé, jusqu'à quand, et ce qui se passe ensuite
      const statusLabel = (status: string) => ({
        active: tr('Actif', 'Active'),
        trialing: tr('Période d’essai', 'Trial'),
        past_due: tr('Paiement en retard', 'Past due'),
        canceled: tr('Résilié', 'Canceled'),
        unpaid: tr('Impayé', 'Unpaid')
      } as Record<string, string>)[status] ?? status;

      const endDate = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

      const currentCard = sub ? `
        <div class="subscription-card">
          <div class="subscription-head">
            <span class="plan-name">${app.escapeHtml(sub.planName)}</span>
            <span class="status-pill ${sub.active ? 'on' : 'off'}">${statusLabel(sub.status)}</span>
          </div>
          <dl class="subscription-facts">
            ${sub.priceLabel ? `<dt>${tr('Formule', 'Billing')}</dt><dd>${app.escapeHtml(sub.priceLabel)}</dd>` : ''}
            ${endDate ? `<dt>${sub.autoRenew && sub.renewable ? tr('Prochain renouvellement', 'Renews on') : tr('Prend fin le', 'Ends on')}</dt><dd>${endDate}</dd>` : ''}
          </dl>
          ${sub.renewable ? `
            <label class="switch-row">
              <span>${tr('Renouvellement automatique', 'Auto-renewal')}
                <small>${sub.autoRenew
                  ? tr('L’abonnement se reconduit tout seul à l’échéance.', 'The subscription renews itself at the end of the period.')
                  : tr('L’abonnement s’arrêtera à l’échéance. Rien n’est perdu d’ici là.', 'The subscription will stop at the end of the period. Nothing is lost until then.')}</small>
              </span>
              <input type="checkbox" class="switch" data-auto-renew ${sub.autoRenew ? 'checked' : ''}>
            </label>` : ''}
          <div class="account-actions account-actions-end">
            <button class="btn-primary btn-ghost btn-sm" data-billing-portal>${tr('Factures et moyen de paiement', 'Invoices and payment method')}</button>
          </div>
        </div>` : '';

      plansEl.innerHTML = `
        ${currentCard}
        <div class="plan-list">
          ${billing.plans.map(plan => {
            const current = sub?.active && sub.planId === plan.id;
            const several = plan.prices.length > 1;
            return `
              <div class="plan-card ${current ? 'current' : ''}">
                <div class="plan-head"><span class="plan-name">${app.escapeHtml(plan.name)}</span></div>
                ${plan.description ? `<p class="modal-text">${app.escapeHtml(plan.description)}</p>` : ''}
                <ul class="plan-boosts">${Object.entries(plan.boosts).map(([k, v]) => `<li>${boostLabel(k, v)}</li>`).join('')}</ul>
                <div class="plan-prices">
                  ${plan.prices.map(price => {
                    const chosen = current && sub?.priceId === price.id;
                    const label = price.label || (price.mode === 'payment' ? tr('Achat unique', 'One-time') : tr('Abonnement', 'Subscription'));
                    return chosen
                      ? `<span class="status-pill on">${tr('En cours', 'Current')} · ${app.escapeHtml(label)}</span>`
                      : `<button class="btn-primary ${several ? '' : 'btn-accent '}btn-sm" data-checkout="${app.escapeHtml(plan.id)}" data-price="${app.escapeHtml(price.id)}">
                           ${several ? app.escapeHtml(label) : `${tr('Choisir', 'Choose')}${label ? ` · ${app.escapeHtml(label)}` : ''}`}
                         </button>`;
                  }).join('')}
                </div>
              </div>`;
          }).join('')}
        </div>
        <p class="field-hint">${tr('Paiement sur Stripe. BetterVault ne voit pas vos coordonnées bancaires.', 'Payment on Stripe. BetterVault never sees your card details.')}</p>`;

      plansEl.querySelectorAll<HTMLButtonElement>('[data-checkout]').forEach(button => button.addEventListener('click', () => {
        void runBusy(button, '…', async () => {
          try {
            const { url } = await accountService.startCheckout(button.dataset.checkout!, button.dataset.price);
            await openExternal(url);
          } catch (err) {
            app.showToast(accountErrorMessage(err), 'error');
          }
        });
      }));

      plansEl.querySelector<HTMLInputElement>('[data-auto-renew]')?.addEventListener('change', async event => {
        const toggle = event.currentTarget as HTMLInputElement;
        const wanted = toggle.checked;
        toggle.disabled = true;
        try {
          const { autoRenew } = await accountService.setAutoRenew(wanted);
          app.showToast(autoRenew
            ? tr('Renouvellement automatique activé', 'Auto-renewal turned on')
            : tr('L’abonnement s’arrêtera à l’échéance', 'The subscription will stop at the end of the period'), 'success', 5000);
          await loadBilling();
        } catch (err) {
          // L'interrupteur revient à son état réel : le serveur n'a rien changé
          toggle.checked = !wanted;
          toggle.disabled = false;
          app.showToast(accountErrorMessage(err), 'error');
        }
      });

      plansEl.querySelector<HTMLButtonElement>('[data-billing-portal]')?.addEventListener('click', event => {
        void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
          try {
            await openExternal((await accountService.openBillingPortal()).url);
          } catch (err) {
            app.showToast(accountErrorMessage(err), 'error');
          }
        });
      });
    } catch (err) {
      usageEl.innerHTML = `<div class="form-error">${app.escapeHtml(accountErrorMessage(err))}</div>`;
    }
  };

  // Documents légaux du serveur
  const loadLegal = async () => {
    const el = $('[data-legal-links]');
    if (!el || !isCloud || !account.serverUrl) return;
    el.innerHTML = '<span class="skeleton skeleton-line" style="width:70%"></span>';
    try {
      const legal = await accountService.getLegal();
      if (!box.isConnected) return;
      // Un serveur qui ne publie pas de documents n'a pas de section à afficher
      if (legal.enabled === false || !legal.documents.length) {
        el.innerHTML = '';
        return;
      }
      el.innerHTML = `
        ${legal.operatorName ? `<p class="field-hint">${tr('Serveur hébergé par', 'Server operated by')} ${app.escapeHtml(legal.operatorName)}</p>` : ''}
        <div class="legal-link-list">${legal.documents.map(doc => `<a href="${app.escapeHtml(account.serverUrl + doc.url)}" target="_blank" rel="noopener">${app.escapeHtml(doc.title)}</a>`).join('')}</div>`;
    } catch {
      el.innerHTML = '';
    }
  };

  action('delete')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    const password = $<HTMLInputElement>('#account-delete-password')?.value ?? '';
    hideError('delete');
    if (!password) return showError('delete', new Error(tr('Saisissez le mot de passe principal', 'Enter the master password')));
    const confirmed = await app.confirmDialog({
      title: tr('Supprimer le compte en ligne ?', 'Delete online account?'),
      message: tr('Le coffre sera supprimé du serveur et vos autres appareils ne pourront plus se synchroniser. C’est définitif.', 'The vault will be deleted from the server and your other devices will stop syncing. This is permanent.'),
      confirmLabel: tr('Supprimer', 'Delete'),
      danger: true
    });
    if (!confirmed) return;
    void runBusy(button, tr('Suppression…', 'Deleting…'), async () => {
      try {
        await accountService.deleteCloudAccount(password);
        app.closeModal();
        app.renderSyncStatus();
        app.showToast(tr('Compte en ligne supprimé', 'Online account deleted'), 'success');
      } catch (err) {
        showError('delete', err);
      }
    });
  });
}
