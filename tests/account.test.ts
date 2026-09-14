import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { AccountService, type KeyValueStorage, type SessionKeyRecord, type SessionKeyStore } from '../src/account/accountService';
import { WrongPasswordError, deriveAccountKeys, generateVaultKey, unwrapVaultKey, wrapVaultKey } from '../src/account/accountCrypto';
import { mergeVaultData } from '../src/account/merge';
import { VaultStore, createEmptyVaultData, normalizeVaultData } from '../src/store/vaultStore';
import type { UnlockedVaultData } from '../src/types/vault';

const FAST_KDF = { t: 1, m: 64, p: 1 };
const PASSWORD = 'correct horse battery staple';

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  dump() { return [...this.map.values()].join('\n'); }
}

const newService = (storage = new MemoryStorage()) => ({ storage, service: new AccountService({ storage, kdf: FAST_KDF, pushDelayMs: 60_000 }) });

describe('Cryptographie du compte', () => {
  it('dérive une preuve d’authentification distincte de la clé et refuse un mauvais mot de passe', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keys = await deriveAccountKeys(PASSWORD, salt, FAST_KDF);
    const again = await deriveAccountKeys(PASSWORD, salt, FAST_KDF);
    expect(keys.authHash).toBe(again.authHash);

    const { raw } = await generateVaultKey();
    const wrapped = await wrapVaultKey(keys.encKey, raw);
    await expect(unwrapVaultKey(again.encKey, wrapped)).resolves.toBeDefined();

    const wrong = await deriveAccountKeys('mauvais mot de passe', salt, FAST_KDF);
    expect(wrong.authHash).not.toBe(keys.authHash);
    await expect(unwrapVaultKey(wrong.encKey, wrapped)).rejects.toBeInstanceOf(WrongPasswordError);
  });
});

describe('Compte local', () => {
  it('ne stocke que des données chiffrées et se déverrouille avec le mot de passe maître', async () => {
    const { storage, service } = newService();
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    await service.createAccount({ email: 'Moi@Exemple.fr', password: PASSWORD, mode: 'local' }, store.getData());
    store.setPersistence(data => void service.save(data));

    store.addCredential({ vaultId: store.getData().activeVaultId, title: 'Banque', username: 'moi', password: 'S3cret-Banque!', website: 'https://banque.fr', domain: 'banque.fr', tags: ['Finances'] });
    await service.flush();

    expect(storage.dump()).not.toContain('S3cret-Banque!');
    expect(storage.dump()).not.toContain('Banque');
    expect(service.getAccount()?.email).toBe('moi@exemple.fr');

    service.lock();
    expect(service.isUnlocked()).toBe(false);
    await expect(service.unlock('mauvais mot de passe')).rejects.toBeInstanceOf(WrongPasswordError);

    const data = await service.unlock(PASSWORD);
    expect(data.credentials[0]).toMatchObject({ title: 'Banque', password: 'S3cret-Banque!', tags: ['Finances'] });
    expect(data.tagDefs.map(t => t.name)).toEqual(['Finances']);
  });

  it('refuse un mot de passe maître trop court', async () => {
    const { service } = newService();
    await expect(service.createAccount({ email: 'a@b.fr', password: 'court', mode: 'local' }, createEmptyVaultData())).rejects.toThrow('10 caractères');
  });
});

describe('Session de l’extension', () => {
  it('reprend le coffre sans mot de passe tant que la session est valide, puis l’oublie au verrouillage', async () => {
    let record: SessionKeyRecord | null = null;
    const sessionStore: SessionKeyStore = {
      load: async () => record,
      save: async value => { record = value; },
      clear: async () => { record = null; }
    };
    const storage = new MemoryStorage();
    const popup = new AccountService({ storage, kdf: FAST_KDF, sessionStore, sessionTtlMs: 60_000 });
    const data = createEmptyVaultData();
    await popup.createAccount({ email: 'ext@exemple.fr', password: PASSWORD, mode: 'local' }, data);
    expect(record).not.toBeNull();
    expect(storage.dump()).not.toContain(record!.key);

    // Nouvelle ouverture du popup : nouvelle instance, même stockage et même session
    const reopened = new AccountService({ storage, kdf: FAST_KDF, sessionStore });
    const resumed = await reopened.resumeSession();
    expect(resumed?.activeVaultId).toBe(data.activeVaultId);
    expect(reopened.isUnlocked()).toBe(true);

    reopened.lock();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(record).toBeNull();
    expect(await new AccountService({ storage, kdf: FAST_KDF, sessionStore }).resumeSession()).toBeNull();

    // Session expirée
    await reopened.unlock(PASSWORD);
    record = { ...record!, expiresAt: Date.now() - 1 };
    expect(await new AccountService({ storage, kdf: FAST_KDF, sessionStore }).resumeSession()).toBeNull();
    expect(record).toBeNull();
  });

  it('ne mémorise rien sans stockage de session (application web)', async () => {
    const { service } = newService();
    await service.createAccount({ email: 'web@exemple.fr', password: PASSWORD, mode: 'local' }, createEmptyVaultData());
    expect(await service.resumeSession()).toBeNull();
  });
});

describe('Tags', () => {
  it('crée, renomme et supprime un tag sur tous les éléments', () => {
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    const vaultId = store.getData().activeVaultId;
    store.addCredential({ vaultId, title: 'A', username: '', password: 'x', website: '', domain: '', tags: ['travail', 'Travail '] });
    store.addTask({ vaultId, title: 'T', status: 'todo', priority: 'low', tags: ['TRAVAIL'] });

    expect(store.getTags().map(t => t.name)).toEqual(['travail']);
    expect(store.getData().credentials[0].tags).toEqual(['travail']);
    expect(store.countTagUsage('travail')).toBe(2);

    const tag = store.getTags()[0];
    store.updateTag(tag.id, { name: 'Pro', color: '#a371f7' });
    expect(store.getData().credentials[0].tags).toEqual(['Pro']);
    expect(store.getData().tasks[0].tags).toEqual(['Pro']);

    store.createTag('Perso');
    expect(() => store.updateTag(tag.id, { name: 'perso' })).toThrow('existe déjà');

    store.deleteTag(tag.id);
    expect(store.getData().credentials[0].tags).toEqual([]);
    expect(store.getData().deleted[tag.id]).toBeTypeOf('number');
  });

  it('migre les anciennes données (mots de passe de coffre factices, tags sans définition)', () => {
    const legacy = {
      vaults: [{ id: 'v1', name: 'Perso', type: 'personal', passwordHash: 'abc', isLocked: true }],
      activeVaultId: 'v1',
      credentials: [{ id: 'c1', vaultId: 'v1', title: 'X', username: '', password: '', website: '', domain: '', tags: ['Dev'], createdAt: 1, updatedAt: 1 }],
      tasks: []
    } as unknown as UnlockedVaultData;
    const data = normalizeVaultData(legacy);
    expect(data.vaults[0]).not.toHaveProperty('passwordHash');
    expect(data.vaults[0]).not.toHaveProperty('isLocked');
    expect(data.tagDefs.map(t => t.name)).toEqual(['Dev']);
  });
});

describe('Fusion des modifications', () => {
  it('garde la version la plus récente et applique les suppressions', () => {
    const base = createEmptyVaultData(1000);
    const vaultId = base.activeVaultId;
    const cred = (id: string, title: string, updatedAt: number) => ({ id, vaultId, title, username: '', password: '', website: '', domain: '', tags: [], createdAt: 1000, updatedAt });

    const local: UnlockedVaultData = { ...base, credentials: [cred('a', 'A local', 3000), cred('b', 'B', 1000)], deleted: {} };
    const remote: UnlockedVaultData = { ...base, credentials: [cred('a', 'A distant', 2000), cred('c', 'C', 2500)], deleted: { b: 2000 } };

    const merged = mergeVaultData(local, remote);
    expect(merged.credentials.map(c => c.title).sort()).toEqual(['A local', 'C']);
    expect(merged.deleted.b).toBe(2000);
  });
});

describe('Serveur BetterVault + synchronisation multi-appareils', () => {
  let server: Server;
  let serverUrl: string;

  beforeAll(async () => {
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-de-test-suffisamment-long-0123456789',
      minKdfMemoryKib: 8,
      authRateLimit: { windowMs: 60_000, max: 1000 }
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const api = (path: string, init?: RequestInit) => fetch(`${serverUrl}${path}`, init);

  it('répond au contrôle de santé et rejette les requêtes non authentifiées', async () => {
    expect(await (await api('/api/v1/health')).json()).toMatchObject({ ok: true, name: 'BetterVault' });
    expect((await api('/api/v1/vault')).status).toBe(401);
    expect((await api('/api/v1/nope')).status).toBe(404);
  });

  it('ne révèle pas si un email possède un compte', async () => {
    const pre = (email: string) => api('/api/v1/sessions/prelogin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).then(r => r.json());
    const first = await pre('inconnu@exemple.fr');
    const second = await pre('inconnu@exemple.fr');
    expect(first).toEqual(second);
    expect(first.salt).toHaveLength(24);
  });

  it('synchronise deux appareils, y compris des modifications simultanées', async () => {
    const deviceA = newService();
    const storeA = new VaultStore();
    storeA.load(createEmptyVaultData());
    await deviceA.service.createAccount({ email: 'sync@exemple.fr', password: PASSWORD, mode: 'cloud', serverUrl }, storeA.getData());
    storeA.setPersistence(data => void deviceA.service.save(data));
    deviceA.service.onRemoteData(data => storeA.load(data));

    // Mot de passe incorrect sur un nouvel appareil
    await expect(newService().service.signIn(serverUrl, 'sync@exemple.fr', 'pas le bon mot de passe')).rejects.toBeInstanceOf(WrongPasswordError);

    const deviceB = newService();
    const storeB = new VaultStore();
    storeB.load(await deviceB.service.signIn(serverUrl, 'sync@exemple.fr', PASSWORD));
    storeB.setPersistence(data => void deviceB.service.save(data));
    deviceB.service.onRemoteData(data => storeB.load(data));

    // A ajoute un élément, B le récupère
    const vaultId = storeA.getData().activeVaultId;
    storeA.addCredential({ vaultId, title: 'Depuis A', username: '', password: 'a', website: '', domain: '', tags: [] });
    await deviceA.service.syncNow();
    await deviceB.service.syncNow();
    expect(storeB.getData().credentials.map(c => c.title)).toEqual(['Depuis A']);

    // Modifications simultanées sans synchro intermédiaire : conflit résolu par fusion
    storeA.addCredential({ vaultId, title: 'A hors ligne', username: '', password: 'a2', website: '', domain: '', tags: [] });
    storeB.addCredential({ vaultId, title: 'B hors ligne', username: '', password: 'b2', website: '', domain: '', tags: [] });
    storeB.deleteCredential(storeB.getData().credentials.find(c => c.title === 'Depuis A')!.id);
    await deviceA.service.syncNow();
    await deviceB.service.syncNow();
    await deviceA.service.syncNow();

    const titles = (store: VaultStore) => store.getData().credentials.map(c => c.title).sort();
    expect(titles(storeA)).toEqual(['A hors ligne', 'B hors ligne']);
    expect(titles(storeB)).toEqual(['A hors ligne', 'B hors ligne']);
    expect(deviceA.service.getSyncState().status).toBe('synced');

    // Le serveur ne détient que du chiffré
    const token = JSON.parse(deviceA.storage.getItem('bettervault.session.v1')!).token;
    const remote = await (await api('/api/v1/vault', { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(JSON.stringify(remote)).not.toContain('hors ligne');
  });

  it('refuse une écriture basée sur une révision obsolète', async () => {
    const { service } = newService();
    await service.createAccount({ email: 'conflit@exemple.fr', password: PASSWORD, mode: 'cloud', serverUrl }, createEmptyVaultData());
    const token = (service as unknown as { cloud: { getToken(): string } }).cloud.getToken();
    const put = (baseRevision: number) => api('/api/v1/vault', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ baseRevision, blob: { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' } })
    });
    expect((await put(1)).status).toBe(200);
    const stale = await put(1);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.details.revision).toBe(2);
  });

  it('passe un compte local en compte synchronisé puis supprime le compte distant', async () => {
    const { service } = newService();
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    await service.createAccount({ email: 'local@exemple.fr', password: PASSWORD, mode: 'local' }, store.getData());
    store.setPersistence(data => void service.save(data));
    store.addCredential({ vaultId: store.getData().activeVaultId, title: 'Local', username: '', password: 'l', website: '', domain: '', tags: [] });
    await service.flush();

    await expect(service.connectCloud(serverUrl, 'mauvais mot de passe')).rejects.toBeInstanceOf(WrongPasswordError);
    await service.connectCloud(serverUrl, PASSWORD);
    expect(service.getAccount()?.mode).toBe('cloud');

    const other = newService();
    const data = await other.service.signIn(serverUrl, 'local@exemple.fr', PASSWORD);
    expect(data.credentials.map(c => c.title)).toEqual(['Local']);

    await service.deleteCloudAccount(PASSWORD);
    expect(service.getAccount()?.mode).toBe('local');
    await expect(newService().service.signIn(serverUrl, 'local@exemple.fr', PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('envoie une modification faite pendant une synchronisation en cours et n’annonce « synchronisé » qu’après envoi', async () => {
    const storage = new MemoryStorage();
    const service = new AccountService({ storage, kdf: FAST_KDF, pushDelayMs: 20 });
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    await service.createAccount({ email: `course-${Date.now()}@exemple.fr`, password: PASSWORD, mode: 'cloud', serverUrl }, store.getData());
    store.setPersistence(data => void service.save(data));

    const statuses: string[] = [];
    service.onSyncStateChange(state => statuses.push(state.status));

    const initialSync = service.syncNow();
    store.addCredential({ vaultId: store.getData().activeVaultId, title: 'Pendant la synchro', username: '', password: 'p', website: '', domain: '', tags: [] });
    await initialSync;

    const token = JSON.parse(storage.getItem('bettervault.session.v1')!).token;
    const remoteRevision = async () => (await (await api('/api/v1/vault', { headers: { Authorization: `Bearer ${token}` } })).json()).revision;

    for (let i = 0; i < 50 && (service.getSyncState().status !== 'synced' || (await remoteRevision()) < 2); i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    expect(await remoteRevision()).toBe(2);
    expect(service.getSyncState().status).toBe('synced');
    const lastSynced = statuses.lastIndexOf('synced');
    expect(statuses.slice(lastSynced + 1)).toEqual([]);
    expect(JSON.parse(storage.getItem('bettervault.vault.v1')!)).toMatchObject({ revision: 2, dirty: false });
  });

  it('change le mot de passe maître sur tous les appareils', async () => {
    const email = `mdp-${Date.now()}@exemple.fr`;
    const NEW_PASSWORD = 'nouveau mot de passe maitre 2026';
    const deviceA = newService();
    const storeA = new VaultStore();
    storeA.load(createEmptyVaultData());
    await deviceA.service.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl }, storeA.getData());
    storeA.setPersistence(data => void deviceA.service.save(data));
    storeA.addCredential({ vaultId: storeA.getData().activeVaultId, title: 'Conservé', username: '', password: 'x', website: '', domain: '', tags: [] });
    await deviceA.service.syncNow();

    const deviceB = newService();
    await deviceB.service.signIn(serverUrl, email, PASSWORD);

    await expect(deviceA.service.changeMasterPassword('mauvais mot de passe', NEW_PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(deviceA.service.changeMasterPassword(PASSWORD, 'court')).rejects.toThrow('10 caractères');
    await deviceA.service.changeMasterPassword(PASSWORD, NEW_PASSWORD);

    deviceA.service.lock();
    await expect(deviceA.service.unlock(PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await deviceA.service.unlock(NEW_PASSWORD)).credentials.map(c => c.title)).toEqual(['Conservé']);

    await expect(newService().service.signIn(serverUrl, email, PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await newService().service.signIn(serverUrl, email, NEW_PASSWORD)).credentials.map(c => c.title)).toEqual(['Conservé']);

    await deviceB.service.syncNow();
    expect(deviceB.service.getSyncState()).toMatchObject({ status: 'error' });
    expect(deviceB.service.getSyncState().message).toContain('modifié sur un autre appareil');
  });

  it('refuse une adresse qui ne répond pas comme un serveur BetterVault', async () => {
    const htmlServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!DOCTYPE html><html></html>');
    });
    await new Promise<void>(resolve => htmlServer.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(htmlServer.address() as AddressInfo).port}`;
    try {
      await expect(newService().service.signIn(url, 'x@exemple.fr', PASSWORD)).rejects.toThrow('ne répond pas comme un serveur BetterVault');
    } finally {
      await new Promise<void>(resolve => htmlServer.close(() => resolve()));
    }
  });

  it('signale le mode hors ligne sans perdre les modifications en attente', async () => {
    const { service } = newService();
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    await service.createAccount({ email: 'offline@exemple.fr', password: PASSWORD, mode: 'cloud', serverUrl }, store.getData());
    store.setPersistence(data => void service.save(data));

    (service as unknown as { cloud: object }).cloud = new (await import('../src/account/cloudClient')).CloudClient('http://127.0.0.1:9', 'x'.repeat(43));
    store.addCredential({ vaultId: store.getData().activeVaultId, title: 'En attente', username: '', password: 'p', website: '', domain: '', tags: [] });
    await service.syncNow();
    expect(service.getSyncState().status).toBe('offline');

    service.lock();
    const data = await service.unlock(PASSWORD);
    expect(data.credentials.map(c => c.title)).toEqual(['En attente']);
  });
});
