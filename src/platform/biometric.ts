import { isTauri, osKeychain, tauriInvoke } from './tauriBridge';

/**
 * Stockage d'un secret déverrouillé par la biométrie de l'appareil.
 *
 * - Android : Keystore, clé RSA déchiffrable seulement après empreinte ou visage (BetterVaultPlugin.kt).
 * - iOS : invite Face ID / Touch ID puis trousseau.
 * - Windows : Windows Hello (visage, empreinte ou code PIN) puis Gestionnaire d'identification.
 * Ailleurs (navigateur, extension, macOS, Linux) : non disponible.
 */

export interface DeviceSecretStore {
  /** Libellé affiché : « Windows Hello », « empreinte ou visage »… */
  label: string;
  available(): Promise<boolean>;
  save(name: string, secret: string): Promise<void>;
  read(name: string, reason: string): Promise<string>;
  remove(name: string): Promise<void>;
}

export class BiometricCancelledError extends Error {
  constructor() {
    super('Authentification annulée');
    this.name = 'BiometricCancelledError';
  }
}

const userAgent = () => globalThis.navigator?.userAgent ?? '';
export const isAndroidApp = () => isTauri() && /Android/i.test(userAgent());
export const isIosApp = () => isTauri() && /iPhone|iPad|iPod/i.test(userAgent());
export const isWindowsApp = () => isTauri() && /Windows/i.test(userAgent());

export function nativeCall<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  return tauriInvoke<T>('native_call', { method, payload });
}

const cancelled = (err: unknown) => /cancel|annul/i.test(String(err instanceof Error ? err.message : err));

export function biometricStore(): DeviceSecretStore | null {
  if (isAndroidApp()) {
    return {
      label: 'empreinte ou visage',
      available: async () => {
        try {
          return (await nativeCall<{ biometricAvailable: boolean }>('status')).biometricAvailable;
        } catch {
          return false;
        }
      },
      save: async (name, secret) => { await nativeCall('secureStore', { key: name, value: secret }); },
      read: async (name, reason) => {
        try {
          return (await nativeCall<{ value: string }>('secureRead', { key: name, title: 'BetterVault', subtitle: reason })).value;
        } catch (err) {
          if (cancelled(err)) throw new BiometricCancelledError();
          throw err;
        }
      },
      remove: async name => { await nativeCall('secureDelete', { key: name }); }
    };
  }

  if (isIosApp()) {
    return {
      label: 'Face ID ou Touch ID',
      available: async () => {
        try {
          const { checkStatus } = await import('@tauri-apps/plugin-biometric');
          return (await checkStatus()).isAvailable;
        } catch {
          return false;
        }
      },
      save: (name, secret) => osKeychain.set(name, secret),
      read: async (name, reason) => {
        const { authenticate } = await import('@tauri-apps/plugin-biometric');
        try {
          await authenticate(reason, { allowDeviceCredential: false });
        } catch {
          throw new BiometricCancelledError();
        }
        const secret = await osKeychain.get(name);
        if (!secret) throw new Error('Secret introuvable dans le trousseau');
        return secret;
      },
      remove: name => osKeychain.remove(name)
    };
  }

  if (isWindowsApp()) {
    return {
      label: 'Windows Hello',
      available: async () => {
        try {
          return await tauriInvoke<boolean>('desktop_biometric_status') && await osKeychain.isAvailable();
        } catch {
          return false;
        }
      },
      save: (name, secret) => osKeychain.set(name, secret),
      read: async (name, reason) => {
        if (!(await tauriInvoke<boolean>('desktop_biometric_verify', { reason }))) throw new BiometricCancelledError();
        const secret = await osKeychain.get(name);
        if (!secret) throw new Error('Secret introuvable dans le Gestionnaire d’identification');
        return secret;
      },
      remove: name => osKeychain.remove(name)
    };
  }

  return null;
}
