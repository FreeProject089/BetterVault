import { describe, it, expect } from 'vitest';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { WrongPasswordError } from '../src/account/accountCrypto';
import { VaultStore, createEmptyVaultData } from '../src/store/vaultStore';

const FAST_KDF = { t: 1, m: 64, p: 1 };
const PASSWORD = 'correct horse battery staple';

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  dump() { return [...this.map.values()].join('\n'); }
}

/** Faux Keystore / trousseau : l'authentification peut être refusée */
class FakeDeviceStore {
  secrets = new Map<string, string>();
  allow = true;
  async save(name: string, secret: string) { this.secrets.set(name, secret); }
  async read(name: string) {
    if (!this.allow) throw new Error('Authentification annulée');
    const secret = this.secrets.get(name);
    if (!secret) throw new Error('introuvable');
    return secret;
  }
  async remove(name: string) { this.secrets.delete(name); }
}

describe('Déverrouillage biométrique', () => {
  it('ouvre le coffre avec le secret de l’appareil, sans l’écrire en clair', async () => {
    const storage = new MemoryStorage();
    const service = new AccountService({ storage, kdf: FAST_KDF });
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    await service.createAccount({ email: 'bio@exemple.fr', password: PASSWORD, mode: 'local' }, store.getData());
    store.setPersistence(data => void service.save(data));
    store.addCredential({ vaultId: store.getData().activeVaultId, title: 'Banque', username: '', password: 'secret', website: '', domain: '', tags: [] });
    await service.flush();

    const device = new FakeDeviceStore();
    await expect(service.enableDeviceUnlock('mauvais mot de passe', device)).rejects.toBeInstanceOf(WrongPasswordError);
    await service.enableDeviceUnlock(PASSWORD, device);
    expect(service.hasDeviceUnlock()).toBe(true);
    const [secret] = [...device.secrets.values()];
    expect(storage.dump()).not.toContain(secret);

    service.lock();
    device.allow = false;
    await expect(service.unlockWithDevice(device, 'test')).rejects.toThrow('annulée');
    device.allow = true;
    expect((await service.unlockWithDevice(device, 'test')).credentials.map(c => c.title)).toEqual(['Banque']);

    // Changer le mot de passe principal désactive le déverrouillage biométrique (secret obsolète)
    await service.changeMasterPassword(PASSWORD, 'nouveau mot de passe principal');
    expect(service.hasDeviceUnlock()).toBe(false);

    await service.enableDeviceUnlock('nouveau mot de passe principal', device);
    await service.disableDeviceUnlock(device);
    expect(service.hasDeviceUnlock()).toBe(false);
    expect(device.secrets.size).toBe(1);
  });
});
