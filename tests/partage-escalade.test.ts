import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { SharedVaultManager } from '../src/account/sharedVaults';
import { VaultStore, createEmptyVaultData } from '../src/store/vaultStore';

/**
 * Un membre d'un coffre partagé est un attaquant plausible : il a un accès
 * légitime et limité, et cherche à l'étendre. Ces tests rejouent les chemins
 * d'élévation trouvés pendant l'audit.
 */

const PASSWORD = 'correct horse battery staple';
const FAST_KDF = { t: 1, m: 8, p: 1 };

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

describe('Coffre partagé : élévation de privilèges', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-de-test-suffisamment-long-0123456789',
      minKdfMemoryKib: 8,
      decoyKdf: FAST_KDF,
      authRateLimit: { windowMs: 60_000, max: 10_000 }
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  let compteur = 0;
  const device = async (name: string) => {
    compteur += 1;
    const email = `${name}-${compteur}@exemple.fr`;
    const account = new AccountService({ storage: new MemoryStorage(), kdf: FAST_KDF, pushDelayMs: 60_000 });
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    await account.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: url }, store.getData());
    const shared = new SharedVaultManager(account);
    await account.getSharingKeys();
    return { email, account, store, shared };
  };

  /** Alice crée un coffre et y invite Mallory avec un rôle volontairement étroit */
  const coffreAvecComplice = async (permissions: Array<'write' | 'attachments' | 'export' | 'manage_members' | 'manage_roles'>) => {
    const alice = await device('alice');
    const mallory = await device('mallory');

    const vaultId = await alice.shared.create('Equipe', 'team');
    const role = await alice.shared.createRole(vaultId, 'Etroit', permissions);
    const cible = await alice.shared.lookup(mallory.email);
    await alice.shared.invite(vaultId, cible, role.id);

    await mallory.shared.refresh();
    await mallory.shared.accept(vaultId);
    await mallory.shared.refresh();

    return { alice, mallory, vaultId, role };
  };

  it('refuse qu’un membre change son propre rôle', async () => {
    const { alice, mallory, vaultId } = await coffreAvecComplice(['manage_members']);

    // Mallory lit la liste des rôles : le rôle « admin » y est visible
    const detail = await mallory.shared.members(vaultId);
    const admin = detail.roles.find(r => r.builtin === 'admin')!;
    const moi = detail.members.find(m => m.email === mallory.email)!;

    await expect(mallory.shared.changeRole(vaultId, moi.userId, admin.id)).rejects.toThrow(/propre rôle/);

    // Et son rôle n'a pas bougé
    const apres = await alice.shared.members(vaultId);
    expect(apres.members.find(m => m.email === mallory.email)!.roleId).not.toBe(admin.id);
  });

  it('refuse d’accorder à autrui une permission qu’on n’a pas', async () => {
    const { alice, mallory, vaultId } = await coffreAvecComplice(['manage_members']);
    const detail = await mallory.shared.members(vaultId);
    const admin = detail.roles.find(r => r.builtin === 'admin')!;
    const alicecible = detail.members.find(m => m.email === alice.email)!;

    // Même sur quelqu'un d'autre, Mallory ne peut pas distribuer « admin »
    await expect(mallory.shared.changeRole(vaultId, alicecible.userId, admin.id)).rejects.toThrow();
  });

  it('refuse de créer un rôle plus puissant que le sien', async () => {
    const { mallory, vaultId } = await coffreAvecComplice(['manage_roles']);

    await expect(mallory.shared.createRole(vaultId, 'Trop fort', ['write', 'manage_members']))
      .rejects.toThrow(/permission/);

    // Un rôle au plus égal au sien reste possible
    const ok = await mallory.shared.createRole(vaultId, 'Pareil', ['manage_roles']);
    expect(ok.permissions).toEqual(['manage_roles']);
  });

  it('refuse d’ajouter des permissions à un rôle existant pour s’en servir ensuite', async () => {
    const { alice, mallory, vaultId } = await coffreAvecComplice(['manage_roles']);
    const cible = await alice.shared.createRole(vaultId, 'Cible', ['write']);

    // Mallory n'a pas « write » : elle ne peut ni toucher ce rôle, ni y ajouter mieux
    await expect(mallory.shared.updateRole(vaultId, cible.id, { permissions: ['write', 'manage_members'] }))
      .rejects.toThrow(/permission/);
  });

  it('refuse le retrait d’un membre sans droit d’écriture, car il rechiffre le coffre', async () => {
    const { alice, mallory, vaultId } = await coffreAvecComplice(['manage_members']);
    const detail = await mallory.shared.members(vaultId);
    const cible = detail.members.find(m => m.email === alice.email)!;

    // removeMember passe par la rotation de clé, qui réécrit tout le contenu chiffré :
    // gérer les membres ne suffit plus, il faut aussi le droit d'écrire.
    await expect(mallory.shared.removeMember(vaultId, cible.userId)).rejects.toThrow();
  });

  it('laisse le propriétaire faire tout cela', async () => {
    const { alice, mallory, vaultId } = await coffreAvecComplice(['manage_members']);
    const detail = await alice.shared.members(vaultId);
    const admin = detail.roles.find(r => r.builtin === 'admin')!;
    const cible = detail.members.find(m => m.email === mallory.email)!;

    await expect(alice.shared.changeRole(vaultId, cible.userId, admin.id)).resolves.toBeUndefined();
    const apres = await alice.shared.members(vaultId);
    expect(apres.members.find(m => m.email === mallory.email)!.roleId).toBe(admin.id);
  });
});
