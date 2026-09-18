import { describe, it, expect } from 'vitest';
import { ProfileStore, DEFAULT_PROFILE, scopedStorage } from '../src/account/profiles';
import { AccountService, ACCOUNT_STORAGE_KEYS, type KeyValueStorage } from '../src/account/accountService';
import { createEmptyVaultData } from '../src/store/vaultStore';

/**
 * Plusieurs comptes sur un appareil : chacun dans ses propres clés, le compte
 * d'avant la fonction retrouvé tel quel, et aucun mélange entre eux.
 */

class MemoryStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

const FAST_KDF = { t: 1, m: 64, p: 1 };
let n = 0;
const id = () => `profil${String(++n).padStart(4, '0')}`;

const creerLocal = async (storage: KeyValueStorage, email: string) => {
  const service = new AccountService({ storage, kdf: FAST_KDF });
  await service.createAccount({ email, password: 'un mot de passe assez long', mode: 'local' }, createEmptyVaultData());
  return service;
};

describe('Comptes multiples', () => {
  it('garde le compte existant sous ses clés d’origine, sans migration', async () => {
    const base = new MemoryStorage();
    await creerLocal(base, 'ancien@exemple.fr');

    const profils = new ProfileStore(base);
    expect(profils.activeId()).toBe(DEFAULT_PROFILE);
    expect(profils.list().map(p => p.email)).toEqual(['ancien@exemple.fr']);
    // Rien n'a été déplacé
    expect(base.getItem('bettervault.account.v1')).toContain('ancien@exemple.fr');
  });

  it('range un nouveau compte à part, sans toucher au premier', async () => {
    const base = new MemoryStorage();
    await creerLocal(base, 'alice@exemple.fr');
    const profils = new ProfileStore(base);

    const nouveau = profils.createEmpty(id);
    await creerLocal(profils.storageFor(nouveau), 'bob@exemple.fr');

    expect(profils.list().map(p => p.email).sort()).toEqual(['alice@exemple.fr', 'bob@exemple.fr']);
    expect(base.getItem('bettervault.account.v1')).toContain('alice@exemple.fr');
    expect(base.getItem(`bettervault.p.${nouveau}.bettervault.account.v1`)).toContain('bob@exemple.fr');
  });

  it('ouvre chaque compte avec son propre mot de passe seulement', async () => {
    const base = new MemoryStorage();
    await creerLocal(base, 'alice@exemple.fr');
    const profils = new ProfileStore(base);
    const bob = profils.createEmpty(id);
    await creerLocal(profils.storageFor(bob), 'bob@exemple.fr');

    profils.activate(DEFAULT_PROFILE);
    const alice = new AccountService({ storage: profils.storageFor(), kdf: FAST_KDF });
    expect(alice.getAccount()?.email).toBe('alice@exemple.fr');
    await expect(alice.unlock('un mot de passe assez long')).resolves.toBeTruthy();

    profils.activate(bob);
    const serviceBob = new AccountService({ storage: profils.storageFor(), kdf: FAST_KDF });
    expect(serviceBob.getAccount()?.email).toBe('bob@exemple.fr');
  });

  it('trie par dernier usage', async () => {
    let horloge = 1000;
    const base = new MemoryStorage();
    await creerLocal(base, 'alice@exemple.fr');
    const profils = new ProfileStore(base, () => horloge);
    profils.touch(DEFAULT_PROFILE);

    horloge = 2000;
    const bob = profils.createEmpty(id);
    await creerLocal(profils.storageFor(bob), 'bob@exemple.fr');
    profils.touch(bob);
    expect(profils.list()[0].email).toBe('bob@exemple.fr');

    horloge = 3000;
    profils.activate(DEFAULT_PROFILE);
    expect(profils.list()[0].email).toBe('alice@exemple.fr');
  });

  it('ne liste pas un ajout abandonné, et le réutilise au suivant', () => {
    const base = new MemoryStorage();
    const profils = new ProfileStore(base);
    const premier = profils.createEmpty(id);
    expect(profils.list()).toEqual([]);

    // Un second « Ajouter un compte » reprend l'emplacement vide plutôt que d'en empiler
    expect(profils.createEmpty(id)).toBe(premier);
  });

  it('oublie un compte entièrement, et revient sur un compte restant', async () => {
    const base = new MemoryStorage();
    await creerLocal(base, 'alice@exemple.fr');
    const profils = new ProfileStore(base);
    const bob = profils.createEmpty(id);
    await creerLocal(profils.storageFor(bob), 'bob@exemple.fr');

    profils.forget(bob, ACCOUNT_STORAGE_KEYS);
    expect([...base.map.keys()].some(k => k.includes(bob))).toBe(false);
    expect(profils.activeId()).toBe(DEFAULT_PROFILE);
    expect(profils.list().map(p => p.email)).toEqual(['alice@exemple.fr']);
  });

  it('refuse d’activer un profil inconnu ou un identifiant forgé', () => {
    const profils = new ProfileStore(new MemoryStorage());
    expect(() => profils.activate('inconnu123')).toThrow();
    expect(() => profils.createEmpty(() => '../../etc')).toThrow();
  });

  it('ignore un profil actif qui n’existe plus', () => {
    const base = new MemoryStorage();
    base.setItem('bettervault.profile.active', 'disparu1234');
    expect(new ProfileStore(base).activeId()).toBe(DEFAULT_PROFILE);
  });

  it('isole les clés : une vue ne voit pas celles d’une autre', () => {
    const base = new MemoryStorage();
    const a = scopedStorage(base, 'aaaaaa');
    const b = scopedStorage(base, 'bbbbbb');
    a.setItem('bettervault.vault.v1', 'secret-a');
    expect(b.getItem('bettervault.vault.v1')).toBeNull();
    expect(scopedStorage(base, DEFAULT_PROFILE).getItem('bettervault.vault.v1')).toBeNull();
  });
});
