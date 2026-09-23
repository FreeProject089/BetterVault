import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { createBackupService, decryptBackup } from '../server/src/backup.ts';
import { S3Client, type S3Like, type S3Object } from '../server/src/s3.ts';

const SECRET = 'secret-de-test-suffisamment-long-0123456789';
const b64 = (n: number) => randomBytes(n).toString('base64');
const blob = (size = 16) => ({ v: 1, iv: b64(12), ct: b64(size) });

describe('Serveur : coffres partagés, rôles et pièces jointes', () => {
  let server: Server;
  let url: string;
  let filesDir: string;

  beforeAll(async () => {
    filesDir = mkdtempSync(join(tmpdir(), 'bv-files-'));
    const settings = settingsFromEnv({});
    settings.limits.maxAttachmentBytes = 1024;
    settings.limits.attachmentQuotaBytes = 1500;
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: SECRET,
      minKdfMemoryKib: 8,
      decoyKdf: { t: 1, m: 64, p: 1 },
      authRateLimit: { windowMs: 60_000, max: 10_000 },
      settings,
      filesDir
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(filesDir, { recursive: true, force: true });
  });

  const api = async (method: string, path: string, token?: string, body?: unknown, raw?: Buffer) => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(raw ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined)
    });
    const type = response.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await response.json() : type.includes('octet') ? Buffer.from(await response.arrayBuffer()) : null;
    return { status: response.status, data };
  };

  const register = async (name: string) => {
    const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.fr`;
    const created = await api('POST', '/api/v1/accounts', undefined, {
      email, authHash: b64(32), kdf: { t: 1, m: 64, p: 1 }, salt: b64(16), wrappedVaultKey: blob(32), vault: blob()
    });
    expect(created.status).toBe(201);
    const token = created.data.token as string;
    expect((await api('PUT', '/api/v1/accounts/keys', token, { publicKey: b64(32), wrappedPrivateKey: blob(48) })).status).toBe(204);
    const me = await api('POST', '/api/v1/users/lookup', token, { email });
    return { email, token, userId: me.data.userId as string };
  };

  it('partage un coffre, applique les rôles et retire un membre en changeant la clé', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');

    const created = await api('POST', '/api/v1/shared-vaults', alice.token, { blob: blob(), wrappedKey: b64(80) });
    expect(created.status).toBe(201);
    const vaultId = created.data.id as string;

    // Un non-membre ne voit pas le coffre
    expect((await api('GET', `/api/v1/shared-vaults/${vaultId}`, bob.token)).status).toBe(404);

    const { data: membersData } = await api('GET', `/api/v1/shared-vaults/${vaultId}/members`, alice.token);
    const role = (key: string) => membersData.roles.find((r: { builtin: string }) => r.builtin === key).id as string;
    expect(membersData.roles.map((r: { builtin: string }) => r.builtin)).toEqual(['owner', 'admin', 'editor', 'viewer']);

    // Invitation : visible mais pas lisible avant acceptation
    const lookup = await api('POST', '/api/v1/users/lookup', alice.token, { email: bob.email });
    expect(lookup.data.publicKey).toHaveLength(44);
    expect((await api('POST', `/api/v1/shared-vaults/${vaultId}/members`, alice.token, { userId: bob.userId, roleId: role('viewer'), wrappedKey: b64(80) })).status).toBe(201);
    const bobList = await api('GET', '/api/v1/shared-vaults', bob.token);
    expect(bobList.data.vaults[0]).toMatchObject({ id: vaultId, status: 'invited', ownerEmail: alice.email, role: { builtin: 'viewer' } });
    expect((await api('GET', `/api/v1/shared-vaults/${vaultId}`, bob.token)).status).toBe(404);
    expect((await api('POST', `/api/v1/shared-vaults/${vaultId}/accept`, bob.token)).status).toBe(204);

    // Lecteur : lecture oui, écriture et gestion non
    const state = await api('GET', `/api/v1/shared-vaults/${vaultId}`, bob.token);
    expect(state.data.revision).toBe(1);
    expect((await api('PUT', `/api/v1/shared-vaults/${vaultId}`, bob.token, { baseRevision: 1, blob: blob() })).status).toBe(403);
    expect((await api('POST', `/api/v1/shared-vaults/${vaultId}/members`, bob.token, { userId: carol.userId, roleId: role('viewer'), wrappedKey: b64(80) })).status).toBe(403);

    // Rôle personnalisé avec écriture
    const custom = await api('POST', `/api/v1/shared-vaults/${vaultId}/roles`, alice.token, { name: 'Support', permissions: ['write', 'attachments'] });
    expect(custom.status).toBe(201);
    expect((await api('POST', `/api/v1/shared-vaults/${vaultId}/roles`, alice.token, { name: 'Pirate', permissions: ['delete_vault'] })).status).toBe(400);
    expect((await api('PATCH', `/api/v1/shared-vaults/${vaultId}/members/${bob.userId}`, alice.token, { roleId: custom.data.id })).status).toBe(204);
    expect((await api('PUT', `/api/v1/shared-vaults/${vaultId}`, bob.token, { baseRevision: 1, blob: blob() })).status).toBe(200);
    expect((await api('PUT', `/api/v1/shared-vaults/${vaultId}`, alice.token, { baseRevision: 1, blob: blob() })).status).toBe(409);
    expect((await api('DELETE', `/api/v1/shared-vaults/${vaultId}/roles/${custom.data.id}`, alice.token)).status).toBe(409);
    expect((await api('DELETE', `/api/v1/shared-vaults/${vaultId}/roles/${role('editor')}`, alice.token)).status).toBe(400);

    // Carol invitée puis retirée par changement de clé : elle perd l'accès
    await api('POST', `/api/v1/shared-vaults/${vaultId}/members`, alice.token, { userId: carol.userId, roleId: role('editor'), wrappedKey: b64(80) });
    await api('POST', `/api/v1/shared-vaults/${vaultId}/accept`, carol.token);
    const rotate = await api('POST', `/api/v1/shared-vaults/${vaultId}/rotate`, alice.token, {
      baseRevision: 2,
      blob: blob(),
      members: [{ userId: alice.userId, wrappedKey: b64(80) }, { userId: bob.userId, wrappedKey: b64(80) }]
    });
    expect(rotate.status).toBe(200);
    expect((await api('GET', `/api/v1/shared-vaults/${vaultId}`, carol.token)).status).toBe(404);
    const afterRotate = await api('GET', `/api/v1/shared-vaults/${vaultId}/members`, alice.token);
    expect(afterRotate.data.members.map((m: { email: string }) => m.email)).toEqual([alice.email, bob.email]);

    // Transfert de propriété puis départ de l'ancien propriétaire
    expect((await api('DELETE', `/api/v1/shared-vaults/${vaultId}/members/${alice.userId}`, alice.token)).status).toBe(400);
    expect((await api('PATCH', `/api/v1/shared-vaults/${vaultId}/members/${bob.userId}`, alice.token, { roleId: role('owner') })).status).toBe(204);
    expect((await api('DELETE', `/api/v1/shared-vaults/${vaultId}/members/${alice.userId}`, alice.token)).status).toBe(204);
    expect((await api('GET', '/api/v1/shared-vaults', bob.token)).data.vaults[0].role.builtin).toBe('owner');
    expect((await api('DELETE', `/api/v1/shared-vaults/${vaultId}`, bob.token)).status).toBe(204);
  });

  it('stocke des pièces jointes chiffrées avec quota et contrôle d’accès', async () => {
    const dan = await register('dan');
    const eve = await register('eve');

    const file = randomBytes(800);
    const uploaded = await api('POST', '/api/v1/attachments', dan.token, undefined, file);
    expect(uploaded.status).toBe(201);
    expect((await api('GET', `/api/v1/attachments/${uploaded.data.id}`, dan.token)).data).toEqual(file);
    expect((await api('GET', `/api/v1/attachments/${uploaded.data.id}`, eve.token)).status).toBe(404);

    expect((await api('POST', '/api/v1/attachments', dan.token, undefined, randomBytes(2000))).status).toBe(413);
    expect((await api('POST', '/api/v1/attachments', dan.token, undefined, randomBytes(900))).data.error.code).toBe('quota_exceeded');
    expect((await api('GET', '/api/v1/attachments/usage', dan.token)).data).toMatchObject({ enabled: true, usedBytes: 800, quotaBytes: 1500 });

    // Coffre partagé : un éditeur peut ajouter, un non-membre non
    const vault = await api('POST', '/api/v1/shared-vaults', dan.token, { blob: blob(), wrappedKey: b64(80) });
    expect((await api('POST', `/api/v1/attachments?vault=${vault.data.id}`, eve.token, undefined, randomBytes(10))).status).toBe(404);
    const shared = await api('POST', `/api/v1/attachments?vault=${vault.data.id}`, dan.token, undefined, randomBytes(100));
    expect(shared.status).toBe(201);

    expect((await api('DELETE', `/api/v1/attachments/${uploaded.data.id}`, dan.token)).status).toBe(204);
    expect(readdirSync(filesDir)).not.toContain(uploaded.data.id);
    expect((await api('GET', `/api/v1/attachments/${uploaded.data.id}`, dan.token)).status).toBe(404);

    // Suppression du coffre partagé : ses fichiers disparaissent
    await api('DELETE', `/api/v1/shared-vaults/${vault.data.id}`, dan.token);
    expect(readdirSync(filesDir)).not.toContain(shared.data.id);
  });
});

describe('Sauvegardes', () => {
  class MemoryS3 implements S3Like {
    objects = new Map<string, { body: Buffer; lastModified: number }>();
    clock = Date.now();
    async put(key: string, body: Buffer) { this.objects.set(key, { body, lastModified: this.clock }); }
    async get(key: string) { return this.objects.get(key)!.body; }
    async delete(key: string) { this.objects.delete(key); }
    async list(prefix: string): Promise<S3Object[]> {
      return [...this.objects].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({ key, size: o.body.length, lastModified: o.lastModified }));
    }
  }

  it('envoie une copie chiffrée de la base et purge selon la durée de conservation', async () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO settings (key, value) VALUES ('marqueur', 'present')").run();
    const filesDir = mkdtempSync(join(tmpdir(), 'bv-backup-files-'));
    const s3 = new MemoryS3();
    let now = Date.now();
    const settings = { enabled: true, intervalHours: 24, retentionDays: 7, s3: { endpoint: 'http://minio:9000', region: 'us-east-1', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', prefix: 'bv', pathStyle: true } };
    const service = createBackupService({ db, filesDir, settings: () => settings, encryptionKey: 'phrase de chiffrement des sauvegardes', clientFactory: () => s3, now: () => now });

    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(filesDir, 'fichier-1'), randomBytes(20));
      const [run] = await service.runNow();
      expect(run).toMatchObject({ status: 'success', files: 1 });

      const dbKey = [...s3.objects.keys()].find(k => k.startsWith('bv/db/'))!;
      expect(dbKey).toMatch(/\.db\.gz\.enc$/);
      const restored = gunzipSync(decryptBackup(s3.objects.get(dbKey)!.body, 'phrase de chiffrement des sauvegardes'));
      expect(restored.subarray(0, 15).toString()).toBe('SQLite format 3');
      expect(restored.includes(Buffer.from('marqueur'))).toBe(true);
      expect(() => decryptBackup(s3.objects.get(dbKey)!.body, 'mauvaise clé')).toThrow('incorrecte');

      // Le fichier n'est pas renvoyé une seconde fois
      now += 10 * 86_400_000;
      s3.clock = now;
      expect((await service.runNow())[0].files).toBe(0);

      // Après 10 jours (conservation 7), l'ancienne copie de base et le fichier supprimé sont purgés
      db.prepare('INSERT INTO deleted_files (id, deleted_at) VALUES (?, ?)').run('fichier-1', now - 9 * 86_400_000);
      now += 1000;
      s3.clock = now;
      await service.runNow();
      const dbCopies = [...s3.objects.keys()].filter(k => k.startsWith('bv/db/'));
      expect(dbCopies).toHaveLength(2);
      expect(s3.objects.has('bv/files/fichier-1')).toBe(false);
      expect(service.history()[0]).toMatchObject({ status: 'success' });
    } finally {
      rmSync(filesDir, { recursive: true, force: true });
    }
  });

  it('signe les requêtes S3 et lit les listes d’objets', async () => {
    const seen: Array<{ method: string; url: string; auth: string; body: number }> = [];
    const fakeFetch = (async (input: string, init: RequestInit) => {
      seen.push({ method: init.method!, url: input, auth: (init.headers as Record<string, string>).authorization, body: (init.body as Buffer | undefined)?.length ?? 0 });
      if (init.method === 'GET') {
        return new Response('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>bv/db/a&amp;b.gz</Key><Size>42</Size><LastModified>2026-09-15T10:00:00.000Z</LastModified></Contents></ListBucketResult>', { status: 200 });
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const client = new S3Client({ endpoint: 'http://minio:9000', region: 'eu-west-3', bucket: 'sauvegardes', accessKeyId: 'AKID', secretAccessKey: 'SECRET', prefix: '', pathStyle: true }, fakeFetch);

    await client.put('bv/db/copie 1.gz', Buffer.from('données'));
    const listed = await client.list('bv/db/');
    expect(listed).toEqual([{ key: 'bv/db/a&b.gz', size: 42, lastModified: Date.parse('2026-09-15T10:00:00.000Z') }]);
    expect(seen[0].url).toBe('http://minio:9000/sauvegardes/bv/db/copie%201.gz');
    expect(seen[0].auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/eu-west-3\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(seen[1].url).toBe('http://minio:9000/sauvegardes/?list-type=2&prefix=bv%2Fdb%2F');

    // Signature stable pour une date donnée
    const date = new Date('2026-01-01T00:00:00Z');
    const a = client.sign('PUT', 'x', {}, Buffer.from('1'), date, 'text/plain');
    const b = client.sign('PUT', 'x', {}, Buffer.from('1'), date, 'text/plain');
    expect(a.headers.authorization).toBe(b.headers.authorization);
    expect(client.sign('PUT', 'x', {}, Buffer.from('2'), date, 'text/plain').headers.authorization).not.toBe(a.headers.authorization);
  });
});
