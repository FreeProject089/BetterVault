import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { compareVv, pickWinner } from '../server/src/cluster.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { createEmptyVaultData } from '../src/store/vaultStore';
import { WrongPasswordError } from '../src/account/accountCrypto';

/**
 * Grappe à confiance signée. Chaque nœud a sa clé ; la grappe a une clé racine qui
 * signe la liste des nœuds autorisés. On vérifie la vie complète d'une grappe :
 * création, invitation, approbation, réplication dans une zone, isolement entre
 * zones, révocation, rotation, et un serveur étranger qui n'obtient rien.
 */

const TOKEN = 'jeton-de-secours-assez-long-0123456789';
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
  url: string;
  server: Server;
  app: ReturnType<typeof createApp>;
  files: string;
  admin: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
}

async function startNode(): Promise<Node> {
  const files = mkdtempSync(join(tmpdir(), 'bv-node-'));
  const app = createApp({
    db: openDatabase(':memory:'),
    serverSecret: `secret-serveur-${Math.random()}-suffisamment-long-0123456789`,
    minKdfMemoryKib: 8,
    decoyKdf: FAST_KDF,
    authRateLimit: { windowMs: 60_000, max: 10_000 },
    settings: settingsFromEnv({}),
    adminTokenHash: createHash('sha256').update(TOKEN).digest('base64'),
    filesDir: files,
    clusterAutoStart: false
  });
  const server = createServer((req, res) => void app(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${url}/api/v1/admin/${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { url, server, app, files, admin };
}

const stopNode = async (node: Node) => {
  node.app.close();
  await new Promise<void>(resolve => node.server.close(() => resolve()));
  rmSync(node.files, { recursive: true, force: true });
};

/** Invite et approuve un nœud ; renvoie son identifiant */
async function enroll(root: Node, node: Node, name: string, zone: string): Promise<string> {
  const invite = await root.admin('POST', 'cluster/invites', {});
  expect(invite.status).toBe(200);
  const join = await node.admin('POST', 'cluster/join', { code: invite.body.code, name, zone, region: 'r1', url: node.url });
  expect(join.status).toBe(200);
  const pending = (await root.admin('GET', 'cluster')).body.pending as Array<{ id: string; fingerprint: string }>;
  const request = pending.at(-1)!;
  // L'empreinte que voit la racine est celle que le nœud affiche : c'est ce que l'administrateur compare
  expect(request.fingerprint).toBe((await node.admin('GET', 'cluster')).body.self.fingerprint);
  expect((await root.admin('POST', `cluster/requests/${request.id}/approve`, {})).status).toBe(200);
  return request.id;
}

const syncAll = async (nodes: Node[]) => {
  for (let round = 0; round < 2; round++) for (const node of nodes) await node.app.cluster.syncNow();
};

describe('Grappe à confiance signée', () => {
  let euW: Node;
  let euE: Node;
  let usE: Node;
  let euEId: string;

  beforeAll(async () => {
    [euW, euE, usE] = await Promise.all([startNode(), startNode(), startNode()]);
    const created = await euW.admin('POST', 'cluster', { clusterName: 'Primary', name: 'EU-W', zone: 'EU', region: 'eu-west', url: euW.url });
    expect(created.status).toBe(200);
    euEId = await enroll(euW, euE, 'EU-E', 'EU');
    await enroll(euW, usE, 'US-E', 'US');
  });

  afterAll(async () => {
    for (const node of [euW, euE, usE]) await stopNode(node);
  });

  it('ajoute les nœuds approuvés au manifeste, signé et diffusé', async () => {
    const vue = (await euE.admin('GET', 'cluster')).body;
    expect(vue.cluster.state).toBe('member');
    expect(vue.cluster.nodes.map((n: { name: string }) => n.name).sort()).toEqual(['EU-E', 'EU-W', 'US-E']);
    expect(vue.cluster.isRoot).toBe(false);
    expect((await euW.admin('GET', 'cluster')).body.cluster.isRoot).toBe(true);
  });

  it('réplique un compte vers les nœuds de sa zone, et seulement eux', async () => {
    const email = `zone-${Date.now()}@exemple.fr`;
    const data = createEmptyVaultData();
    data.credentials.push({ id: 'cred-1', vaultId: data.activeVaultId, title: 'Banque', tags: [], createdAt: 1, updatedAt: 1 } as never);
    await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: euW.url }, data);
    await syncAll([euW, euE, usE]);

    const ouvert = await newService().signIn(euE.url, email, PASSWORD);
    expect(ouvert.credentials.map(c => c.title)).toContain('Banque');
    // Le nœud américain fait partie de la grappe, mais pas de la zone EU : il n'a rien reçu
    await expect(newService().signIn(usE.url, email, PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('ne perd rien quand deux nœuds de la zone changent en même temps', async () => {
    const email = `concurrent-${Date.now()}@exemple.fr`;
    await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: euW.url }, createEmptyVaultData());
    await syncAll([euW, euE]);

    const a = newService();
    const dataA = await a.signIn(euW.url, email, PASSWORD);
    dataA.credentials.push({ id: 'cred-w', vaultId: dataA.activeVaultId, title: 'Écrit à l’ouest', tags: [], createdAt: 3, updatedAt: 3 } as never);
    await a.save(dataA);
    await a.syncNow();

    const b = newService();
    const dataB = await b.signIn(euE.url, email, PASSWORD);
    dataB.credentials.push({ id: 'cred-e', vaultId: dataB.activeVaultId, title: 'Écrit à l’est', tags: [], createdAt: 4, updatedAt: 4 } as never);
    await b.save(dataB);
    await b.syncNow();

    await syncAll([euW, euE]);
    const c = newService();
    await c.signIn(euE.url, email, PASSWORD);
    await c.syncNow();
    expect(c.getLatestData()!.credentials.map(x => x.title)).toEqual(expect.arrayContaining(['Écrit à l’ouest', 'Écrit à l’est']));
  });

  it('recopie les fichiers chiffrés par tranches', async () => {
    const email = `fichier-${Date.now()}@exemple.fr`;
    const service = newService();
    await service.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: euW.url }, createEmptyVaultData());
    const contenu = Buffer.alloc(9 * 1024 * 1024, 7);
    const { id } = await service.withCloud(client => client.uploadAttachment(new Uint8Array(contenu)));
    await syncAll([euW, euE]);
    expect(existsSync(join(euE.files, id))).toBe(true);
    expect(readFileSync(join(euE.files, id)).equals(contenu)).toBe(true);
  });

  it('refuse une requête non signée, signée par une clé inconnue, ou rejouée', async () => {
    expect((await fetch(`${euW.url}/api/v1/cluster/changes`)).status).toBe(401);

    // Une clé qui n'est dans aucun manifeste, même en se faisant passer pour un nœud connu
    const { privateKey } = generateKeyPairSync('ed25519');
    const path = '/api/v1/cluster/changes?since=0';
    const time = String(Date.now());
    const nonce = 'a'.repeat(32);
    const payload = [euEId, time, nonce, 'GET', path, createHash('sha256').update('').digest('base64url')].join('\n');
    const forged = { 'X-BV-Node': euEId, 'X-BV-Time': time, 'X-BV-Nonce': nonce, 'X-BV-Signature': sign(null, Buffer.from(payload), privateKey).toString('base64url') };
    expect((await fetch(euW.url + path, { headers: forged })).status).toBe(401);
  });

  it('refuse un code d’invitation réutilisé', async () => {
    const intrus = await startNode();
    try {
      const invite = (await euW.admin('POST', 'cluster/invites', {})).body.code;
      const autre = await startNode();
      try {
        expect((await autre.admin('POST', 'cluster/join', { code: invite, name: 'Autre', zone: 'EU', region: 'r', url: autre.url })).status).toBe(200);
        expect((await intrus.admin('POST', 'cluster/join', { code: invite, name: 'Intrus', zone: 'EU', region: 'r', url: intrus.url })).status).toBe(401);
      } finally {
        await stopNode(autre);
      }
    } finally {
      await stopNode(intrus);
    }
  });

  it('coupe immédiatement un nœud révoqué', async () => {
    const extra = await startNode();
    try {
      const id = await enroll(euW, extra, 'EU-X', 'EU');
      await syncAll([euW, extra]);
      expect((await euW.admin('GET', 'cluster')).body.cluster.nodes.find((n: { id: string }) => n.id === id).status).toBe('active');

      expect((await euW.admin('POST', `cluster/nodes/${id}/revoke`, {})).status).toBe(200);
      // Le nœud révoqué apprend son sort, et plus aucun nœud ne lui répond
      const vue = (await extra.admin('GET', 'cluster')).body;
      expect(vue.cluster.nodes.find((n: { id: string }) => n.id === id).status).toBe('revoked');
      await extra.app.cluster.syncNow();
      expect(extra.app.cluster.status()).toEqual([]);

      const email = `apres-revocation-${Date.now()}@exemple.fr`;
      await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: euW.url }, createEmptyVaultData());
      await syncAll([euW, extra]);
      await expect(newService().signIn(extra.url, email, PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);

      // Un nœud révoqué peut ensuite être retiré du manifeste
      expect((await euW.admin('DELETE', `cluster/nodes/${id}`)).status).toBe(200);
    } finally {
      await stopNode(extra);
    }
  });

  it('suspend puis reprend un nœud désactivé, sans perte', async () => {
    expect((await euW.admin('PATCH', `cluster/nodes/${euEId}`, { status: 'disabled' })).status).toBe(200);
    const email = `pendant-pause-${Date.now()}@exemple.fr`;
    await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: euW.url }, createEmptyVaultData());
    await syncAll([euW, euE]);
    await expect(newService().signIn(euE.url, email, PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);

    // Réactivé, il rattrape ce qui s'est passé pendant la pause
    expect((await euW.admin('PATCH', `cluster/nodes/${euEId}`, { status: 'active' })).status).toBe(200);
    await syncAll([euW, euE]);
    await expect(newService().signIn(euE.url, email, PASSWORD)).resolves.toBeTruthy();
  });

  it('change la clé d’un nœud et la clé racine sans interrompre la réplication', async () => {
    const avant = (await euE.admin('GET', 'cluster')).body.self.fingerprint;
    expect((await euE.admin('POST', 'cluster/node-key/rotate', {})).status).toBe(200);
    expect((await euE.admin('GET', 'cluster')).body.self.fingerprint).not.toBe(avant);

    const racineAvant = (await euE.admin('GET', 'cluster')).body.cluster.rootFingerprint;
    expect((await euW.admin('POST', 'cluster/root-key/rotate', {})).status).toBe(200);
    expect((await euE.admin('GET', 'cluster')).body.cluster.rootFingerprint).not.toBe(racineAvant);

    const email = `apres-rotation-${Date.now()}@exemple.fr`;
    await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: euW.url }, createEmptyVaultData());
    await syncAll([euW, euE]);
    await expect(newService().signIn(euE.url, email, PASSWORD)).resolves.toBeTruthy();
  });

  it('refuse les actions de grappe sans reconfirmation ni rôle suffisant', async () => {
    const r = await fetch(`${euW.url}/api/v1/admin/cluster/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(401);
  });

  it('exporte la clé racine chiffrée, et la reprend sur un autre nœud', async () => {
    expect((await euW.admin('POST', 'cluster/root-key/export', { passphrase: 'court' })).status).toBe(400);
    const backup = (await euW.admin('POST', 'cluster/root-key/export', { passphrase: 'une phrase de passe longue et solide' })).body;
    expect(JSON.stringify(backup)).not.toContain('PRIVATE KEY');
    expect((await euE.admin('POST', 'cluster/root-key/import', { backup, passphrase: 'mauvaise phrase de passe tout à fait' })).status).toBe(401);
    expect((await euE.admin('POST', 'cluster/root-key/import', { backup, passphrase: 'une phrase de passe longue et solide' })).status).toBe(200);
    expect((await euE.admin('GET', 'cluster')).body.cluster.isRoot).toBe(true);
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
