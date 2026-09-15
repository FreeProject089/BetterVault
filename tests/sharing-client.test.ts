import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { createEmptyVaultData } from '../src/store/vaultStore';
import { generateSharingKeyPair, keyFingerprint, openSealed, sealForRecipient, SharingKeyError } from '../src/account/sharingCrypto';
import { decryptFile, encryptFile } from '../src/account/attachmentCrypto';

const FAST_KDF = { t: 1, m: 64, p: 1 };
const PASSWORD = 'correct horse battery staple';

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

describe('Cryptographie du partage', () => {
  it('scelle une clé pour un destinataire et refuse une autre clé privée', async () => {
    const alice = generateSharingKeyPair();
    const bob = generateSharingKeyPair();
    const vaultKey = crypto.getRandomValues(new Uint8Array(32));

    const sealed = await sealForRecipient(vaultKey, bob.publicKey);
    expect(await openSealed(sealed, bob.privateKey)).toEqual(vaultKey);
    await expect(openSealed(sealed, alice.privateKey)).rejects.toBeInstanceOf(SharingKeyError);
    // Deux scellements du même secret diffèrent (clé éphémère)
    expect(await sealForRecipient(vaultKey, bob.publicKey)).not.toBe(sealed);

    const fingerprint = await keyFingerprint(bob.publicKey);
    expect(fingerprint).toMatch(/^([0-9A-F]{4} ){4}[0-9A-F]{4}$/);
    expect(await keyFingerprint(bob.publicKey)).toBe(fingerprint);
  });

  it('chiffre une pièce jointe avec sa propre clé', async () => {
    const data = crypto.getRandomValues(new Uint8Array(5000));
    const { payload, key } = await encryptFile(data);
    expect(payload.length).toBe(data.length + 1 + 12 + 16);
    expect(await decryptFile(payload, key)).toEqual(data);
    const other = await encryptFile(data);
    await expect(decryptFile(payload, other.key)).rejects.toThrow('altérée');
  });
});

describe('Clés de partage du compte', () => {
  let server: Server;
  let url: string;
  let filesDir: string;

  beforeAll(async () => {
    filesDir = mkdtempSync(join(tmpdir(), 'bv-client-files-'));
    server = createServer(createApp({ db: openDatabase(':memory:'), serverSecret: 'secret-de-test-suffisamment-long-0123456789', minKdfMemoryKib: 8, authRateLimit: { windowMs: 60_000, max: 10_000 }, filesDir }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(filesDir, { recursive: true, force: true });
  });

  it('crée les clés une fois et les retrouve sur un autre appareil', async () => {
    const email = `cles-${Date.now()}@exemple.fr`;
    const deviceA = new AccountService({ storage: new MemoryStorage(), kdf: FAST_KDF, pushDelayMs: 60_000 });
    await deviceA.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: url }, createEmptyVaultData());
    const keysA = await deviceA.getSharingKeys();

    const deviceB = new AccountService({ storage: new MemoryStorage(), kdf: FAST_KDF, pushDelayMs: 60_000 });
    await deviceB.signIn(url, email, PASSWORD);
    const keysB = await deviceB.getSharingKeys();
    expect(keysB.publicKey).toEqual(keysA.publicKey);
    expect(keysB.privateKey).toEqual(keysA.privateKey);

    // Le serveur ne détient que la clé publique et la clé privée chiffrée
    const lookup = await deviceB.withCloud(client => client.lookupUser(email));
    expect(lookup.publicKey).toBe(Buffer.from(keysA.publicKey).toString('base64'));

    // Pièce jointe aller-retour par le client
    const { payload, key } = await encryptFile(new TextEncoder().encode('contrat.pdf'));
    const uploaded = await deviceA.withCloud(client => client.uploadAttachment(payload));
    const downloaded = await deviceB.withCloud(client => client.downloadAttachment(uploaded.id));
    expect(new TextDecoder().decode(await decryptFile(downloaded, key))).toBe('contrat.pdf');
  });
});
