import { AccountService, type SessionKeyRecord, type SessionKeyStore } from '../account/accountService';
import { generateTOTP } from '../crypto/totpEngine';
import { i18n } from '../i18n';
import { getServiceIconSvg } from '../icons/serviceIcons';
import { normalizeVaultData } from '../store/vaultStore';
import type { CredentialItem, UnlockedVaultData } from '../types/vault';
import { mountAuthScreen } from '../ui/authScreen';
import { fillLoginForm } from './fillLoginForm';

const tr = (fr: string, en: string) => (i18n.getLocale() === 'fr' ? fr : en);
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

const ICONS = {
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'
};

// Clé du coffre gardée en mémoire de session du navigateur (effacée au verrouillage, à l'expiration ou à la fermeture du navigateur)
const SESSION_KEY = 'bettervault.session-key';
const sessionArea = typeof chrome !== 'undefined' ? chrome.storage?.session : undefined;
const sessionStore: SessionKeyStore | undefined = sessionArea && {
  load: async () => ((await sessionArea.get(SESSION_KEY))[SESSION_KEY] as SessionKeyRecord | undefined) ?? null,
  save: record => sessionArea.set({ [SESSION_KEY]: record }),
  clear: () => sessionArea.remove(SESSION_KEY)
};

const service = new AccountService({ sessionStore });
const authRoot = document.getElementById('auth-screen') as HTMLElement;
const appRoot = document.getElementById('popup-app') as HTMLElement;
const listEl = document.getElementById('popup-list') as HTMLElement;
const siteEl = document.getElementById('popup-site') as HTMLElement;
const statusEl = document.getElementById('popup-status') as HTMLElement;
const searchInput = document.getElementById('popup-search') as HTMLInputElement;

let credentials: CredentialItem[] = [];
let activeTab: chrome.tabs.Tab | null = null;
let statusTimer = 0;

const hostOf = (url?: string): string => {
  try {
    const parsed = url ? new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`) : null;
    return parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.hostname.toLowerCase().replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

const credentialDomain = (cred: CredentialItem) => hostOf(cred.website) || (cred.domain ?? '').toLowerCase().replace(/^www\./, '');

const matchesSite = (cred: CredentialItem, host: string) => {
  const domain = credentialDomain(cred);
  return !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));
};

function showStatus(message: string, kind: 'info' | 'error' = 'info'): void {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
  statusEl.hidden = false;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusEl.hidden = true;
  }, 3500);
}

async function copy(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    showStatus(label);
  } catch {
    showStatus(tr('Copie refusée par le navigateur', 'Copy blocked by the browser'), 'error');
  }
}

function renderRow(cred: CredentialItem, canFill: boolean): string {
  const totp = cred.totpSecret ? generateTOTP(cred.totpSecret) : null;
  return `
    <div class="popup-row" data-id="${escapeHtml(cred.id)}">
      <div class="record-icon">${getServiceIconSvg(cred.website || cred.title)}</div>
      <div class="popup-row-info">
        <div class="record-title">${escapeHtml(cred.title)}</div>
        <div class="record-sub">${escapeHtml(cred.username || credentialDomain(cred) || '—')}</div>
      </div>
      <div class="popup-row-actions">
        ${totp ? `<button class="popup-totp" type="button" data-action="totp" title="${tr('Copier le code 2FA', 'Copy 2FA code')}"><span data-totp="${escapeHtml(cred.id)}">${totp.token}</span></button>` : ''}
        ${cred.username ? `<button class="icon-btn" type="button" data-action="username" title="${tr('Copier l’identifiant', 'Copy username')}" aria-label="${tr('Copier l’identifiant', 'Copy username')}">${ICONS.user}</button>` : ''}
        <button class="icon-btn" type="button" data-action="password" title="${tr('Copier le mot de passe', 'Copy password')}" aria-label="${tr('Copier le mot de passe', 'Copy password')}">${ICONS.copy}</button>
        ${canFill ? `<button class="btn-primary btn-accent popup-fill" type="button" data-action="fill">${tr('Remplir', 'Fill')}</button>` : ''}
      </div>
    </div>`;
}

function render(): void {
  const host = hostOf(activeTab?.url);
  siteEl.textContent = host ? host : tr('Aucun site web dans cet onglet', 'No website in this tab');

  const query = searchInput.value.trim().toLowerCase();
  const visible = credentials.filter(c => !query || [c.title, c.username, c.website].some(v => v?.toLowerCase().includes(query)));
  const forSite = visible.filter(c => matchesSite(c, host));
  const others = visible.filter(c => !matchesSite(c, host));

  if (credentials.length === 0) {
    listEl.innerHTML = `<p class="popup-empty">${tr('Le coffre est vide. Ajoutez des identifiants depuis l’application.', 'The vault is empty. Add credentials from the app.')}</p>`;
    return;
  }
  if (visible.length === 0) {
    listEl.innerHTML = `<p class="popup-empty">${tr('Aucun résultat', 'No results')}</p>`;
    return;
  }

  listEl.innerHTML = `
    ${forSite.length ? `<div class="popup-section">${tr('Pour ce site', 'For this site')}</div>${forSite.map(c => renderRow(c, true)).join('')}` : ''}
    ${others.length ? `<div class="popup-section">${forSite.length ? tr('Autres identifiants', 'Other credentials') : tr('Identifiants', 'Credentials')}</div>${others.slice(0, query ? 100 : 30).map(c => renderRow(c, false)).join('')}` : ''}`;
}

function refreshTotpCodes(): void {
  listEl.querySelectorAll<HTMLElement>('[data-totp]').forEach(el => {
    const cred = credentials.find(c => c.id === el.dataset.totp);
    const result = cred?.totpSecret ? generateTOTP(cred.totpSecret) : null;
    if (result) el.textContent = result.token;
  });
}

async function fill(cred: CredentialItem): Promise<void> {
  const tabId = activeTab?.id;
  if (tabId === undefined || !matchesSite(cred, hostOf(activeTab?.url))) {
    showStatus(tr('Cet identifiant ne correspond pas au site ouvert', 'This credential does not match the open site'), 'error');
    return;
  }
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: fillLoginForm,
      args: [cred.username, cred.password, credentialDomain(cred)]
    });
    if (injection?.result?.filled) {
      window.close();
    } else if (injection?.result?.reason === 'domain') {
      showStatus(tr('Remplissage refusé : le domaine de la page ne correspond pas', 'Fill refused: the page domain does not match'), 'error');
    } else {
      showStatus(tr('Aucun formulaire de connexion trouvé sur la page', 'No login form found on the page'), 'error');
    }
  } catch {
    showStatus(tr('Impossible de remplir sur cette page', 'Cannot fill on this page'), 'error');
  }
}

function showVault(data: UnlockedVaultData): void {
  credentials = normalizeVaultData(data).credentials;
  authRoot.hidden = true;
  appRoot.hidden = false;
  render();
  searchInput.focus();
}

async function init(): Promise<void> {
  document.documentElement.lang = i18n.getLocale();
  searchInput.placeholder = tr('Rechercher', 'Search');

  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    activeTab = null;
  }

  const auth = mountAuthScreen(authRoot, service, data => {
    showVault(data);
    void service.syncNow();
  });

  service.onRemoteData(data => {
    credentials = normalizeVaultData(data).credentials;
    render();
  });

  listEl.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const id = button?.closest<HTMLElement>('[data-id]')?.dataset.id;
    const cred = credentials.find(c => c.id === id);
    if (!button || !cred) return;

    switch (button.dataset.action) {
      case 'fill':
        void fill(cred);
        break;
      case 'username':
        void copy(cred.username, tr('Identifiant copié', 'Username copied'));
        break;
      case 'password':
        void copy(cred.password, tr('Mot de passe copié', 'Password copied'));
        break;
      case 'totp': {
        const code = cred.totpSecret ? generateTOTP(cred.totpSecret)?.token : null;
        if (code) void copy(code, tr('Code 2FA copié', '2FA code copied'));
        break;
      }
    }
  });

  searchInput.addEventListener('input', render);

  document.getElementById('popup-open-app')?.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    window.close();
  });

  document.getElementById('popup-lock')?.addEventListener('click', () => {
    service.lock();
    credentials = [];
    listEl.innerHTML = '';
    appRoot.hidden = true;
    auth.show();
  });

  window.setInterval(refreshTotpCodes, 1000);

  const resumed = await service.resumeSession();
  if (resumed) {
    showVault(resumed);
    void service.syncNow();
  } else {
    auth.show();
  }
}

void init();
