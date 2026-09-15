import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { SharedVaultManager } from '../src/account/sharedVaults';
import { VaultStore, createEmptyVaultData } from '../src/store/vaultStore';

const FAST_KDF = { t: 1, m: 64, p: 1 };
const PASSWORD = 'correct horse battery staple';

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

describe('Coffres partagés (application)', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer(createApp({ db: openDatabase(':memory:'), serverSecret: 'secret-de-test-suffisamment-long-0123456789', minKdfMemoryKib: 8, authRateLimit: { windowMs: 60_000, max: 10_000 } }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const device = async (name: string) => {
    const email = `${name}-${Date.now()}@exemple.fr`;
    const account = new AccountService({ storage: new MemoryStorage(), kdf: FAST_KDF, pushDelayMs: 60_000 });
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    await account.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: url }, store.getData());
    const shared = new SharedVaultManager(account);
    store.setPersistence(data => void account.save(shared.split(data)));
    await account.getSharingKeys();
    return { email, account, store, shared };
  };

  it('partage, modifie selon le rôle, retire un membre en changeant la clé', async () => {
    const alice = await device('alice');
    const bob = await device('bob');

    const vaultId = await alice.shared.create('Famille', 'team');
    alice.store.load(alice.shared.mergeInto(alice.shared.split(alice.store.getData(), { save: false })));
    expect(alice.store.getData().vaults.map(v => v.name)).toEqual(['Personnel', 'Famille']);

    // Ajout d'un identifiant dans le coffre partagé : envoyé au serveur, pas dans le coffre personnel
    alice.store.addCredential({ vaultId, title: 'Wi-Fi', username: '', password: 'mot-de-passe-wifi', website: '', domain: '', tags: ['Maison'] });
    await alice.shared.flush();
    await alice.account.flush();
    const personal = alice.shared.split(alice.store.getData(), { save: false });
    expect(personal.credentials).toEqual([]);
    expect(personal.vaults.map(v => v.name)).toEqual(['Personnel']);

    // Invitation de Bob en lecteur : vérification de l'empreinte puis acceptation
    const { roles } = await alice.shared.members(vaultId);
    const viewer = roles.find(r => r.builtin === 'viewer')!;
    const editor = roles.find(r => r.builtin === 'editor')!;
    const found = await alice.shared.lookup(bob.email);
    expect(found.fingerprint).toMatch(/^([0-9A-F]{4} ){4}[0-9A-F]{4}$/);
    await alice.shared.invite(vaultId, found, viewer.id);

    await bob.shared.refresh();
    expect(bob.shared.invitations().map(i => i.ownerEmail)).toEqual([alice.email]);
    await bob.shared.accept(vaultId);
    bob.store.load(bob.shared.mergeInto(bob.shared.split(bob.store.getData(), { save: false })));
    expect(bob.store.getData().credentials.map(c => c.title)).toEqual(['Wi-Fi']);
    expect(bob.shared.can(vaultId, 'write')).toBe(false);

    // Un lecteur ne peut pas enregistrer : rien n'est envoyé
    bob.store.addCredential({ vaultId, title: 'Refusé', username: '', password: 'x', website: '', domain: '', tags: [] });
    await bob.shared.flush();
    await alice.shared.refresh();
    expect(alice.shared.mergeInto(createEmptyVaultData()).credentials.map(c => c.title)).toEqual(['Wi-Fi']);

    // Éditeur : ses modifications arrivent chez Alice
    await alice.shared.changeRole(vaultId, found.userId, editor.id);
    await bob.shared.refresh();
    expect(bob.shared.can(vaultId, 'write')).toBe(true);
    bob.store.load(bob.shared.mergeInto(bob.shared.split(bob.store.getData(), { save: false })));
    bob.store.addCredential({ vaultId, title: 'Box internet', username: 'admin', password: 'y', website: '', domain: '', tags: [] });
    await bob.shared.flush();
    await alice.shared.refresh();
    expect(alice.shared.mergeInto(createEmptyVaultData()).credentials.map(c => c.title).sort()).toEqual(['Box internet', 'Wi-Fi']);

    // Retrait de Bob : nouvelle clé, Bob perd l'accès
    await alice.shared.removeMember(vaultId, found.userId);
    await bob.shared.refresh();
    expect(bob.shared.isShared(vaultId)).toBe(false);
    const aliceAgain = new SharedVaultManager(alice.account);
    await aliceAgain.refresh();
    expect(aliceAgain.mergeInto(createEmptyVaultData()).credentials.map(c => c.title).sort()).toEqual(['Box internet', 'Wi-Fi']);
  });
});
