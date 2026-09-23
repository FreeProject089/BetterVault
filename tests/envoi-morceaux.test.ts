import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { CloudClient } from '../src/account/cloudClient';
import { createEmptyVaultData } from '../src/store/vaultStore';

/**
 * Envoi des gros fichiers par morceaux : reprise après coupure, morceaux rejoués ou
 * dans le désordre refusés, place réservée pendant l'envoi, fichier final intact.
 */

const PASSWORD = 'correct horse battery staple';
const FAST_KDF = { t: 1, m: 64, p: 1 };
const MB = 1024 * 1024;

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

describe('Envoi par morceaux', () => {
  let server: Server;
  let url: string;
  let client: CloudClient;
  let token: string;
  const filesDir = mkdtempSync(join(tmpdir(), 'bv-morceaux-'));

  beforeAll(async () => {
    const base = settingsFromEnv({});
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-de-test-suffisamment-long-0123456789',
      minKdfMemoryKib: 8,
      decoyKdf: FAST_KDF,
      authRateLimit: { windowMs: 60_000, max: 10_000 },
      filesDir,
      settings: { ...base, limits: { ...base.limits, maxAttachmentBytes: 20 * MB, attachmentQuotaBytes: 30 * MB } }
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const storage = new MemoryStorage();
    const service = new AccountService({ storage, kdf: FAST_KDF, pushDelayMs: 60_000 });
    await service.createAccount({ email: `morceaux-${Date.now()}@exemple.fr`, password: PASSWORD, mode: 'cloud', serverUrl: url }, createEmptyVaultData());
    token = JSON.parse(storage.getItem('bettervault.session.v1') ?? '{}').token as string;
    client = new CloudClient(url);
    (client as unknown as { token: string }).token = token;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const payload = (size: number) => {
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = (i * 31 + 7) & 255;
    return data;
  };

  it('envoie un gros fichier par morceaux et le rend intact', async () => {
    const data = payload(9 * MB + 123);
    const steps: number[] = [];
    const { id, size } = await client.uploadAttachment(data, undefined, sent => steps.push(sent));
    expect(size).toBe(data.length);
    expect(steps.length).toBe(3);
    const back = await client.downloadAttachment(id);
    expect(Buffer.from(back).equals(Buffer.from(data))).toBe(true);
    expect(readdirSync(filesDir).some(f => f.startsWith('.part-'))).toBe(false);
  });

  it('reprend après une coupure au milieu', async () => {
    const data = payload(9 * MB);
    const realFetch = globalThis.fetch;
    let cut = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!cut && init?.method === 'PUT' && String(input).includes('offset=4194304')) {
        cut = true;
        throw new TypeError('connexion perdue');
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const { id } = await client.uploadAttachment(data);
      expect(cut).toBe(true);
      expect(Buffer.from(await client.downloadAttachment(id)).equals(Buffer.from(data))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('refuse un morceau rejoué ou dans le désordre, et un envoi incomplet', async () => {
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const start = await (await fetch(`${url}/api/v1/attachments/uploads`, { method: 'POST', headers: auth, body: JSON.stringify({ size: 10 }) })).json();
    const put = (offset: number, bytes: number) => fetch(`${url}/api/v1/attachments/uploads/${start.uploadId}?offset=${offset}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes)
    });
    expect((await put(0, 4)).status).toBe(200);
    expect((await put(0, 4)).status).toBe(409);
    expect((await put(8, 2)).status).toBe(409);
    expect((await put(4, 10)).status).toBe(400);
    expect((await fetch(`${url}/api/v1/attachments/uploads/${start.uploadId}/complete`, { method: 'POST', headers: auth })).status).toBe(409);
    expect((await fetch(`${url}/api/v1/attachments/uploads/${start.uploadId}`, { method: 'DELETE', headers: auth })).status).toBe(204);
  });

  it('réserve la place pendant l’envoi : pas de dépassement du quota à deux', async () => {
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    // 18 Mo déjà stockés par les tests précédents ; 11 Mo réservés laissent moins d'1 Mo
    const first = await fetch(`${url}/api/v1/attachments/uploads`, { method: 'POST', headers: auth, body: JSON.stringify({ size: 11 * MB }) });
    expect(first.status).toBe(201);
    const second = await fetch(`${url}/api/v1/attachments/uploads`, { method: 'POST', headers: auth, body: JSON.stringify({ size: 2 * MB }) });
    expect(second.status).toBe(413);
    await fetch(`${url}/api/v1/attachments/uploads/${(await first.json()).uploadId}`, { method: 'DELETE', headers: auth });
    expect((await fetch(`${url}/api/v1/attachments/uploads`, { method: 'POST', headers: auth, body: JSON.stringify({ size: 2 * MB }) })).status).toBe(201);
  });

  it('refuse l’envoi sans session valide', async () => {
    const start = await (await fetch(`${url}/api/v1/attachments/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ size: 10 }) })).json();
    const res = await fetch(`${url}/api/v1/attachments/uploads/${start.uploadId}`, { headers: { Authorization: 'Bearer inconnu' } });
    expect(res.status).toBe(401);
  });
});
