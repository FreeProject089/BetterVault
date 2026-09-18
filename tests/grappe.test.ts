import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { clusterFromEnv, compareVv, pickWinner, signedHeaders, type ClusterConfig } from '../server/src/cluster.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { createEmptyVaultData } from '../src/store/vaultStore';

/**
 * Deux nœuds d'un même opérateur (« eu » et « us ») : un compte créé sur l'un
 * s'ouvre sur l'autre, ses fichiers suivent, et un serveur étranger à la grappe
 * n'obtient rien.
 */

const SECRET = 'secret-de-grappe-suffisamment-long-0123456789';
const PASSWORD = 'correct horse battery staple';
const FAST_KDF = { t: 1, m: 64, p: 1 };

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}
const newService = () => new AccountService({ storage: new MemoryStorage(), kdf: FAST_KDF, pushDelayMs: 60_000 });

interface Node {
  id: string;
  url: string;
  server: Server;
  app: ReturnType<typeof createApp>;
  files: string;
}

/** Démarre d'abord les serveurs pour connaître leurs ports, puis les relie */
async function startCluster(ids: string[], secretFor: (id: string) => string = () => SECRET): Promise<Node[]> {
  const holders = await Promise.all(ids.map(async id => {
    let app: ReturnType<typeof createApp> | null = null;
    const server = createServer((req, res) => void app!(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { id, server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, set: (a: typeof app) => { app = a; } };
  }));

  return holders.map(holder => {
    const config: ClusterConfig = {
      nodeId: holder.id,
      secret: secretFor(holder.id),
      peers: holders.filter(h => h.id !== holder.id).map(h => ({ id: h.id, url: h.url })),
      intervalMs: 60_000
    };
    const files = mkdtempSync(join(tmpdir(), `bv-${holder.id}-`));
    const app = createApp({
      db: openDatabase(':memory:'),
      serverSecret: `secret-serveur-${holder.id}-suffisamment-long-0123456789`,
      minKdfMemoryKib: 8,
      authRateLimit: { windowMs: 60_000, max: 10_000 },
      settings: settingsFromEnv({}),
      filesDir: files,
      cluster: config,
      clusterAutoStart: false
    });
    holder.set(app);
    return { id: holder.id, url: holder.url, server: holder.server, app, files };
  });
}

const stop = async (nodes: Node[]) => {
  for (const node of nodes) {
    node.app.close();
    await new Promise<void>(resolve => node.server.close(() => resolve()));
    rmSync(node.files, { recursive: true, force: true });
  }
};

const syncAll = async (nodes: Node[]) => {
  for (let round = 0; round < 2; round++) for (const node of nodes) await node.app.cluster!.syncNow();
};

describe('Grappe de serveurs', () => {
  let nodes: Node[];
  let eu: Node;
  let us: Node;

  beforeAll(async () => {
    nodes = await startCluster(['eu', 'us']);
    [eu, us] = nodes;
  });

  afterAll(async () => {
    await stop(nodes);
  });

  it('ouvre sur un nœud un compte créé sur l’autre, coffre compris', async () => {
    const email = `grappe-${Date.now()}@exemple.fr`;
    const data = createEmptyVaultData();
    data.credentials.push({ id: 'cred-1', vaultId: data.activeVaultId, title: 'Banque', password: 'p4ss', tags: [], createdAt: 1, updatedAt: 1 } as never);
    await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: eu.url }, data);

    await syncAll(nodes);

    const surUs = newService();
    const ouvert = await surUs.signIn(us.url, email, PASSWORD);
    expect(ouvert.credentials.map(c => c.title)).toContain('Banque');
  });

  it('fait suivre les modifications dans les deux sens', async () => {
    const email = `aller-retour-${Date.now()}@exemple.fr`;
    const depuisEu = newService();
    const data = createEmptyVaultData();
    await depuisEu.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: eu.url }, data);
    await syncAll(nodes);

    const depuisUs = newService();
    const vu = await depuisUs.signIn(us.url, email, PASSWORD);
    vu.credentials.push({ id: 'cred-us', vaultId: vu.activeVaultId, title: 'Ajouté aux US', tags: [], createdAt: 2, updatedAt: 2 } as never);
    await depuisUs.save(vu);
    await depuisUs.syncNow();
    await syncAll(nodes);

    const relu = await newService().signIn(eu.url, email, PASSWORD);
    expect(relu.credentials.map(c => c.title)).toContain('Ajouté aux US');
  });

  it('ne perd rien quand les deux nœuds changent en même temps', async () => {
    const email = `concurrent-${Date.now()}@exemple.fr`;
    await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: eu.url }, createEmptyVaultData());
    await syncAll(nodes);

    // Deux appareils, chacun sur son nœud, écrivent avant que les nœuds se parlent
    const a = newService();
    const dataA = await a.signIn(eu.url, email, PASSWORD);
    dataA.credentials.push({ id: 'cred-eu', vaultId: dataA.activeVaultId, title: 'Écrit en Europe', tags: [], createdAt: 3, updatedAt: 3 } as never);
    await a.save(dataA);
    await a.syncNow();

    const b = newService();
    const dataB = await b.signIn(us.url, email, PASSWORD);
    dataB.credentials.push({ id: 'cred-us2', vaultId: dataB.activeVaultId, title: 'Écrit aux États-Unis', tags: [], createdAt: 4, updatedAt: 4 } as never);
    await b.save(dataB);
    await b.syncNow();

    await syncAll(nodes);

    // Un appareil qui se connecte fusionne la version écartée : les deux ajouts survivent
    const c = newService();
    const fusion = await c.signIn(us.url, email, PASSWORD);
    await c.syncNow();
    const titres = (c.getLatestData() ?? fusion).credentials.map(x => x.title);
    expect(titres).toEqual(expect.arrayContaining(['Écrit en Europe', 'Écrit aux États-Unis']));

    // La fusion est acquittée, et l'acquittement atteint l'autre nœud : plus rien à refusionner
    await syncAll(nodes);
    for (const node of [eu, us]) {
      const d = newService();
      const vu = await d.signIn(node.url, email, PASSWORD);
      expect(vu.credentials.map(x => x.title)).toEqual(expect.arrayContaining(['Écrit en Europe', 'Écrit aux États-Unis']));
      expect((await d.withCloud(client => client.getVault())).conflicts).toBeUndefined();
    }
  });

  it('refuse l’adresse d’un compte qui existe déjà sur l’autre nœud', async () => {
    const email = `doublon-${Date.now()}@exemple.fr`;
    await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: eu.url }, createEmptyVaultData());
    // Pas encore synchronisé : c'est la vérification à l'inscription qui doit bloquer
    await expect(newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: us.url }, createEmptyVaultData()))
      .rejects.toThrow();
  });

  it('propage la suppression d’un compte', async () => {
    const email = `suppression-${Date.now()}@exemple.fr`;
    const service = newService();
    await service.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: eu.url }, createEmptyVaultData());
    await syncAll(nodes);
    await expect(newService().signIn(us.url, email, PASSWORD)).resolves.toBeTruthy();

    await service.deleteCloudAccount(PASSWORD);
    await syncAll(nodes);
    await expect(newService().signIn(us.url, email, PASSWORD)).rejects.toThrow();
  });

  it('recopie les fichiers chiffrés, par tranches', async () => {
    const email = `fichier-${Date.now()}@exemple.fr`;
    const service = newService();
    await service.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: eu.url }, createEmptyVaultData());
    // 9 Mo : trois tranches de 4 Mo au plus
    const contenu = Buffer.alloc(9 * 1024 * 1024, 7);
    const { id } = await service.withCloud(client => client.uploadAttachment(new Uint8Array(contenu)));
    await syncAll(nodes);

    expect(existsSync(join(us.files, id))).toBe(true);
    expect(readFileSync(join(us.files, id)).equals(contenu)).toBe(true);
  });

  it('n’ouvre rien à une requête non signée ou mal signée', async () => {
    expect((await fetch(`${eu.url}/api/v1/cluster/changes`)).status).toBe(401);

    const etranger: ClusterConfig = { nodeId: 'us', secret: 'un-autre-secret-tout-aussi-long-0123456789', peers: [], intervalMs: 1 };
    const path = '/api/v1/cluster/changes?since=0';
    expect((await fetch(eu.url + path, { headers: signedHeaders(etranger, 'GET', path) })).status).toBe(401);

    // Bon secret, mais nœud non déclaré : refusé aussi
    const inconnu: ClusterConfig = { nodeId: 'ap', secret: SECRET, peers: [], intervalMs: 1 };
    expect((await fetch(eu.url + path, { headers: signedHeaders(inconnu, 'GET', path) })).status).toBe(401);
  });

  it('refuse le rejeu d’une requête signée', async () => {
    const vrai: ClusterConfig = { nodeId: 'us', secret: SECRET, peers: [], intervalMs: 1 };
    const path = '/api/v1/cluster/changes?since=0';
    const headers = signedHeaders(vrai, 'GET', path);
    expect((await fetch(eu.url + path, { headers })).status).toBe(200);
    expect((await fetch(eu.url + path, { headers })).status).toBe(401);
  });
});

describe('Grappe : serveur d’un autre opérateur', () => {
  it('ne réplique rien vers un nœud qui n’a pas le secret', async () => {
    const nodes = await startCluster(['eu', 'xx'], id => (id === 'xx' ? 'un-secret-different-et-assez-long-0123456789' : SECRET));
    try {
      const [eu, xx] = nodes;
      const email = `isole-${Date.now()}@exemple.fr`;
      await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: eu.url }, createEmptyVaultData());
      await syncAll(nodes);

      await expect(newService().signIn(xx.url, email, PASSWORD)).rejects.toThrow();
      expect(xx.app.cluster!.status()[0].lastError).toMatch(/401/);
    } finally {
      await stop(nodes);
    }
  });
});

describe('Vecteurs de version', () => {
  it('ordonne correctement', () => {
    expect(compareVv({ eu: 2 }, { eu: 1 })).toBe('newer');
    expect(compareVv({ eu: 1 }, { eu: 1, us: 1 })).toBe('older');
    expect(compareVv({ eu: 2, us: 1 }, { eu: 1, us: 2 })).toBe('concurrent');
    expect(compareVv({}, {})).toBe('equal');
  });

  it('départage pareil des deux côtés', () => {
    const a = { vv: { eu: 2, us: 1 }, fingerprint: 'aaa' };
    const b = { vv: { eu: 1, us: 2 }, fingerprint: 'bbb' };
    expect(pickWinner(a, b)).toBe('b');
    expect(pickWinner(b, a)).toBe('a');
  });
});

describe('Configuration', () => {
  it('reste désactivée sans variable', () => {
    expect(clusterFromEnv({})).toBeNull();
  });

  it('exige un secret long et des nœuds en https', () => {
    expect(() => clusterFromEnv({ CLUSTER_NODE_ID: 'eu', CLUSTER_SECRET: 'court' })).toThrow(/32/);
    expect(() => clusterFromEnv({ CLUSTER_NODE_ID: 'eu', CLUSTER_SECRET: SECRET, CLUSTER_PEERS: 'us=http://us.exemple.fr' })).toThrow(/https/);
    expect(clusterFromEnv({ CLUSTER_NODE_ID: 'eu', CLUSTER_SECRET: SECRET, CLUSTER_PEERS: 'us=https://us.exemple.fr/' })!.peers)
      .toEqual([{ id: 'us', url: 'https://us.exemple.fr' }]);
  });

  it('refuse de se déclarer lui-même comme pair', () => {
    expect(() => clusterFromEnv({ CLUSTER_NODE_ID: 'eu', CLUSTER_SECRET: SECRET, CLUSTER_PEERS: 'eu=https://eu.exemple.fr' })).toThrow();
  });
});

// Garde l'import utilisé même si un test est désactivé
void writeFileSync;
