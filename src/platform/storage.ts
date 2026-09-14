import type { KeyValueStorage } from '../account/accountService';
import { isTauri, tauriInvoke } from './tauriBridge';

/** Clés du compte à reprendre depuis la webview (compte, coffre chiffré, session) */
const ACCOUNT_KEYS = ['bettervault.account.v1', 'bettervault.vault.v1', 'bettervault.session.v1'];

/**
 * Stockage persistant de l'appareil pour le compte et le coffre chiffré.
 *
 * - Application Tauri (Windows, macOS, Linux, Android, iOS) : fichier dans le dossier de données
 *   de l'application, écrit de façon atomique. Plus fiable que le stockage de la webview,
 *   qui peut être vidé avec le cache.
 * - Navigateur et extension : localStorage, avec une demande de stockage persistant pour que
 *   le navigateur ne l'efface pas en cas de manque d'espace.
 */
export async function createDeviceStorage(): Promise<KeyValueStorage> {
  if (!isTauri()) {
    void navigator.storage?.persist?.().catch(() => false);
    return globalThis.localStorage;
  }

  const entries = new Map(Object.entries(await tauriInvoke<Record<string, string>>('storage_read_all')));
  let pending: Promise<void> = Promise.resolve();

  const persist = () => {
    const snapshot = Object.fromEntries(entries);
    pending = pending
      .then(() => tauriInvoke<void>('storage_write_all', { entries: snapshot }))
      .catch(err => console.error('Écriture du stockage de l’application impossible', err));
  };

  // Reprise des données enregistrées par une version précédente dans le stockage de la webview
  let migrated = false;
  for (const key of ACCOUNT_KEYS) {
    const value = globalThis.localStorage.getItem(key);
    if (value !== null && !entries.has(key)) {
      entries.set(key, value);
      migrated = true;
    }
  }
  if (migrated) persist();

  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
      persist();
    },
    removeItem: key => {
      if (entries.delete(key)) persist();
    }
  };
}
