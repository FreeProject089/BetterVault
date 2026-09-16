/**
 * Pont vers le cœur Rust Tauri v2. Toutes les fonctions dégradent proprement
 * (null / false) lorsque l'application tourne dans un navigateur classique.
 */

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function getInvoke(): InvokeFn | null {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: InvokeFn } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function' ? internals.invoke : null;
}

export function isTauri(): boolean {
  return getInvoke() !== null;
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = getInvoke();
  if (!invoke) throw new Error('Runtime Tauri indisponible');
  return invoke<T>(cmd, args);
}

/**
 * Ouvre une adresse hors de l'application : navigateur du système dans les applications
 * de bureau et mobiles (où target="_blank" ne fait rien), nouvel onglet ailleurs.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Adresse non prise en charge');
  if (isTauri()) {
    await tauriInvoke<void>('plugin:opener|open_url', { url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/** Argon2id natif (Rust) — retourne null hors Tauri pour basculer sur l'implémentation JS */
export async function nativeArgon2id(
  password: string,
  salt: Uint8Array,
  params: { t: number; m: number; p: number }
): Promise<Uint8Array | null> {
  if (!isTauri()) return null;
  try {
    const out = await tauriInvoke<number[]>('derive_key_argon2', {
      passphrase: password,
      salt: Array.from(salt),
      memoryKib: params.m,
      iterations: params.t,
      parallelism: params.p
    });
    return new Uint8Array(out);
  } catch (err) {
    console.warn('Argon2id natif indisponible, repli sur WebAssembly/JS', err);
    return null;
  }
}

/** Enregistre un fichier dans le dossier Téléchargements de l'appareil (application de bureau) */
export async function saveFileNative(fileName: string, content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return tauriInvoke<string>('save_export_file', { fileName, bytes: Array.from(bytes) });
}

/** Trousseau du système (Windows Credential Manager, macOS Keychain, Secret Service) */
export const osKeychain = {
  async isAvailable(): Promise<boolean> {
    if (!isTauri()) return false;
    try {
      return await tauriInvoke<boolean>('get_os_keychain_available');
    } catch {
      return false;
    }
  },

  async set(account: string, secret: string): Promise<void> {
    await tauriInvoke<void>('keychain_set_secret', { account, secret });
  },

  async get(account: string): Promise<string | null> {
    if (!isTauri()) return null;
    return tauriInvoke<string | null>('keychain_get_secret', { account });
  },

  async remove(account: string): Promise<void> {
    if (!isTauri()) return;
    await tauriInvoke<void>('keychain_delete_secret', { account });
  }
};
