import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { decodeCbor, originMatches } from '../server/src/webauthn.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { deriveAccountKeys } from '../src/account/accountCrypto';
import { fromBase64 } from '../src/account/accountCrypto';
import { createEmptyVaultData } from '../src/store/vaultStore';

/**
 * Clé de sécurité en second facteur, avec un authentificateur logiciel qui produit
 * exactement ce que renverrait une vraie clé : CBOR, COSE, signature ECDSA P-256.
 */

const PASSWORD = 'correct horse battery staple';
const FAST_KDF = { t: 1, m: 64, p: 1 };
const RP = 'app.exemple.fr';
const ORIGIN = `https://${RP}`;

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

/* ── Encodeur CBOR minimal pour fabriquer l'attestation ── */
const head = (major: number, n: number) => n < 24 ? Buffer.from([major << 5 | n])
  : n < 256 ? Buffer.from([major << 5 | 24, n]) : Buffer.from([major << 5 | 25, n >> 8, n & 255]);
const cbor = (v: unknown): Buffer => {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('type');
};

const sha = (data: Buffer | string) => createHash('sha256').update(data).digest();
const b64u = (b: Buffer) => b.toString('base64url');

class SoftKey {
  readonly id = Buffer.from('cle-logicielle-0001');
  private readonly priv: KeyObject;
  private readonly jwk: { x: string; y: string };
  count = 0;
  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.priv = privateKey;
    this.jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  }
  private authData(rpId: string, withKey: boolean) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.count);
    const parts = [sha(rpId), Buffer.from([withKey ? 0x41 : 0x01]), counter];
    if (withKey) {
      const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(this.jwk.x, 'base64url')], [-3, Buffer.from(this.jwk.y, 'base64url')]]));
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.id.length);
      parts.push(Buffer.alloc(16), len, this.id, cose);
    }
    return Buffer.concat(parts);
  }
  create(challenge: string, origin = ORIGIN, rpId = RP) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }));
    const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(rpId, true)]]));
    return { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) };
  }
  get(challenge: string, origin = ORIGIN, rpId = RP) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
    const authenticatorData = this.authData(rpId, false);
    const signature = sign('sha256', Buffer.concat([authenticatorData, sha(clientDataJSON)]), this.priv);
    return { id: b64u(this.id), clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature) };
  }
}

describe('Clé de sécurité (WebAuthn)', () => {
  let server: Server;
  let url: string;
  let email: string;
  let authHash: string;
  let token: string;

  const call = async (method: string, path: string, body?: unknown, auth = true) => {
    const res = await fetch(url + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json = res.status === 204 ? null : await res.json();
    return { status: res.status, json };
  };
  const login = (extra: Record<string, unknown> = {}) => call('POST', '/api/v1/sessions', { email, authHash, notify: false, ...extra }, false);

  beforeAll(async () => {
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-de-test-suffisamment-long-0123456789',
      minKdfMemoryKib: 8,
      authRateLimit: { windowMs: 60_000, max: 10_000 },
      settings: settingsFromEnv({})
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    email = `cle-${Date.now()}@exemple.fr`;
    await new AccountService({ storage: new MemoryStorage(), kdf: FAST_KDF, pushDelayMs: 60_000 })
      .createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: url }, createEmptyVaultData());
    const pre = await (await fetch(`${url}/api/v1/sessions/prelogin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })).json();
    authHash = (await deriveAccountKeys(PASSWORD, fromBase64(pre.salt), pre.kdf)).authHash;
    token = (await login()).json.token;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const key = new SoftKey();

  it('refuse d’ajouter une clé sans le mot de passe', async () => {
    const r = await call('POST', '/api/v1/accounts/security-keys/options', { authHash: Buffer.alloc(32).toString('base64'), rpId: RP });
    expect(r.status).toBe(403);
  });

  it('refuse une attestation faite pour une autre origine', async () => {
    const options = (await call('POST', '/api/v1/accounts/security-keys/options', { authHash, rpId: RP })).json;
    const r = await call('POST', '/api/v1/accounts/security-keys', { name: 'x', rpId: RP, ...new SoftKey().create(options.challenge, 'https://hameconnage.exemple') });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('webauthn_origin');
  });

  it('enregistre une clé, et le défi ne sert qu’une fois', async () => {
    const options = (await call('POST', '/api/v1/accounts/security-keys/options', { authHash, rpId: RP })).json;
    expect(options.rp.id).toBe(RP);
    const attestation = key.create(options.challenge);
    const r = await call('POST', '/api/v1/accounts/security-keys', { name: 'YubiKey', rpId: RP, ...attestation });
    expect(r.status).toBe(201);
    expect(r.json.name).toBe('YubiKey');
    const again = await call('POST', '/api/v1/accounts/security-keys', { name: 'bis', rpId: RP, ...attestation });
    expect(again.status).toBe(400);
    expect((await call('GET', '/api/v1/accounts/me')).json.securityKeys).toHaveLength(1);
  });

  it('exige la clé à la connexion, et donne le défi', async () => {
    const r = await login({ rpId: RP });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe('second_factor_required');
    expect(r.json.error.details.webauthn.allowCredentials[0].id).toBe(b64u(key.id));
  });

  it('se connecte avec la clé', async () => {
    const options = (await login({ rpId: RP })).json.error.details.webauthn;
    const r = await login({ rpId: RP, webauthn: key.get(options.challenge) });
    expect(r.status).toBe(200);
    expect(r.json.token).toBeTruthy();
  });

  it('refuse une signature rejouée ou falsifiée', async () => {
    const options = (await login({ rpId: RP })).json.error.details.webauthn;
    const assertion = key.get(options.challenge);
    expect((await login({ rpId: RP, webauthn: assertion })).status).toBe(200);
    expect((await login({ rpId: RP, webauthn: assertion })).status).toBe(400);

    const next = (await login({ rpId: RP })).json.error.details.webauthn;
    const forged = { ...key.get(next.challenge), signature: b64u(Buffer.alloc(70, 1)) };
    expect((await login({ rpId: RP, webauthn: forged })).status).toBe(401);
  });

  it('refuse un compteur qui recule (clé copiée)', async () => {
    const options = (await login({ rpId: RP })).json.error.details.webauthn;
    key.count = 0;
    const r = await login({ rpId: RP, webauthn: key.get(options.challenge) });
    expect(r.json.error.code).toBe('webauthn_cloned');
    key.count = 1000;
  });

  it('explique quand la clé appartient à une autre application', async () => {
    const r = await login({ rpId: 'autre.exemple.fr' });
    expect(r.json.error.code).toBe('security_key_elsewhere');
  });

  it('retire la clé avec le mot de passe', async () => {
    const id = b64u(key.id);
    expect((await call('DELETE', `/api/v1/accounts/security-keys/${id}`, { authHash })).status).toBe(204);
    expect((await login({ rpId: RP })).status).toBe(200);
  });

  it('n’accepte que des origines sûres du bon domaine', () => {
    expect(originMatches('https://app.exemple.fr', 'app.exemple.fr')).toBe(true);
    expect(originMatches('http://app.exemple.fr', 'app.exemple.fr')).toBe(false);
    expect(originMatches('http://localhost:3000', 'localhost')).toBe(true);
    expect(originMatches('http://tauri.localhost', 'tauri.localhost')).toBe(true);
    expect(originMatches('https://exemple.fr.evil.com', 'exemple.fr')).toBe(false);
    expect(() => decodeCbor(Buffer.from([0x5f]))).toThrow();
  });
});
