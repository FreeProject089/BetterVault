import type { SessionKeyRecord, SessionKeyStore } from '../account/accountService';
import type { CredentialItem } from '../types/vault';
import { fillLoginForm } from './fillLoginForm';

/**
 * L'extension affiche l'application complète : dans le popup de la barre d'outils,
 * dans le panneau latéral ou dans un onglet. Ce module gère ce qui est propre à l'extension.
 */

export type ExtensionSurface = 'popup' | 'panel' | 'tab';

export function extensionSurface(): ExtensionSurface | null {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return null;
  const surface = new URLSearchParams(location.search).get('surface');
  return surface === 'popup' || surface === 'panel' ? surface : 'tab';
}

// Clé du coffre gardée en mémoire de session du navigateur (effacée au verrouillage, à l'expiration ou à la fermeture du navigateur)
const SESSION_KEY = 'bettervault.session-key';

export function extensionSessionStore(): SessionKeyStore | undefined {
  const area = extensionSurface() ? chrome.storage?.session : undefined;
  if (!area) return undefined;
  return {
    load: async () => ((await area.get(SESSION_KEY))[SESSION_KEY] as SessionKeyRecord | undefined) ?? null,
    save: record => area.set({ [SESSION_KEY]: record }),
    clear: () => area.remove(SESSION_KEY)
  };
}

export const hostOf = (url?: string): string => {
  try {
    const parsed = url ? new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`) : null;
    return parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.hostname.toLowerCase().replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

export const credentialDomain = (cred: CredentialItem) => hostOf(cred.website) || (cred.domain ?? '').toLowerCase().replace(/^www\./, '');

export function matchesSite(cred: CredentialItem, host: string): boolean {
  const domain = credentialDomain(cred);
  return !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));
}

/** Onglet actif du navigateur (hors onglets de l'extension elle-même) */
export async function activeTabHost(): Promise<{ tabId?: number; host: string }> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || tab.url?.startsWith(chrome.runtime.getURL(''))) return { host: '' };
    return { tabId: tab.id, host: hostOf(tab.url) };
  } catch {
    return { host: '' };
  }
}

export type FillOutcome = 'filled' | 'domain' | 'no-fields' | 'unavailable';

export async function fillActiveTab(cred: CredentialItem): Promise<FillOutcome> {
  const { tabId, host } = await activeTabHost();
  if (tabId === undefined) return 'unavailable';
  if (!matchesSite(cred, host)) return 'domain';
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: fillLoginForm,
      args: [cred.username, cred.password, credentialDomain(cred)]
    });
    if (injection?.result?.filled) return 'filled';
    return injection?.result?.reason === 'domain' ? 'domain' : 'no-fields';
  } catch {
    return 'unavailable';
  }
}

export async function openSidePanel(): Promise<boolean> {
  try {
    if (chrome.sidePanel?.open) {
      const window = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: window.id });
      return true;
    }
    if (chrome.sidebarAction?.open) {
      await chrome.sidebarAction.open();
      return true;
    }
  } catch {
    // Navigateur sans panneau latéral
  }
  return false;
}

export function openFullTab(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
}
