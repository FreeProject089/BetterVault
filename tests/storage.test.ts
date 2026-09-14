import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeviceStorage } from '../src/platform/storage';

class MemoryLocalStorage {
  private readonly map = new Map<string, string>();
  get length() { return this.map.size; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('Stockage de l’appareil', () => {
  it('utilise le localStorage dans le navigateur', async () => {
    const local = new MemoryLocalStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('navigator', { storage: { persist: vi.fn(async () => true) } });

    const storage = await createDeviceStorage();
    storage.setItem('bettervault.vault.v1', 'chiffré');
    expect(local.getItem('bettervault.vault.v1')).toBe('chiffré');
  });

  it('sous Tauri, lit et écrit le fichier de l’application et reprend les anciennes données de la webview', async () => {
    const local = new MemoryLocalStorage();
    local.setItem('bettervault.account.v1', '{"email":"ancien@exemple.fr"}');
    local.setItem('bettervault.vault.v1', 'coffre-webview');
    local.setItem('bettervault.theme', 'dark');
    vi.stubGlobal('localStorage', local);

    let file: Record<string, string> = { 'bettervault.vault.v1': 'coffre-fichier' };
    const invoke = vi.fn(async (cmd: string, args?: { entries?: Record<string, string> }) => {
      if (cmd === 'storage_read_all') return { ...file };
      if (cmd === 'storage_write_all') {
        file = { ...args!.entries! };
        return undefined;
      }
      throw new Error(`commande inattendue ${cmd}`);
    });
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };

    const storage = await createDeviceStorage();

    // Le fichier prime ; les clés absentes du fichier sont reprises depuis la webview
    expect(storage.getItem('bettervault.vault.v1')).toBe('coffre-fichier');
    expect(storage.getItem('bettervault.account.v1')).toBe('{"email":"ancien@exemple.fr"}');
    expect(storage.getItem('bettervault.theme')).toBeNull();

    storage.setItem('bettervault.session.v1', 'jeton');
    storage.removeItem('bettervault.vault.v1');
    await vi.waitFor(() => expect(file).toEqual({
      'bettervault.account.v1': '{"email":"ancien@exemple.fr"}',
      'bettervault.session.v1': 'jeton'
    }));
  });
});
