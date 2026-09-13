import { describe, it, expect } from 'vitest';
import { SyncEngine } from '../src/sync/syncEngine';
import { UnlockedVaultData } from '../src/types/vault';

describe('Zero-Knowledge E2EE Sync Engine', () => {
  const engine = new SyncEngine();
  const mockPassphrase = 'Master-Sync-Passphrase-2026!#$';

  const mockVaultData: UnlockedVaultData = {
    vaults: [
      { id: 'v1', name: 'Perso Sync', type: 'personal', isLocked: false }
    ],
    activeVaultId: 'v1',
    credentials: [
      {
        id: 'c1',
        vaultId: 'v1',
        title: 'Cloudflare Zero Trust',
        username: 'admin@sync.corp',
        password: 'TopSecretPassword99!',
        website: 'https://dash.cloudflare.com',
        domain: 'cloudflare.com',
        tags: ['cloud', 'sync'],
        createdAt: 1700000000000,
        updatedAt: 1700000000000
      }
    ],
    tasks: []
  };

  it('should encrypt vault data into an opaque payload without leaking plaintext', async () => {
    const payload = await engine.createEncryptedSyncPayload(mockVaultData, mockPassphrase);

    expect(payload.version).toBe(1);
    expect(payload.cipher).toBe('AES-256-GCM');
    expect(payload.ciphertext).toBeDefined();
    expect(payload.salt).toBeDefined();
    expect(payload.iv).toBeDefined();

    // Plaintext strings must not exist anywhere in the ciphertext
    expect(payload.ciphertext).not.toContain('Cloudflare Zero Trust');
    expect(payload.ciphertext).not.toContain('TopSecretPassword99!');
  });

  it('should cleanly decrypt the sync payload back to identical data using the passphrase', async () => {
    const payload = await engine.createEncryptedSyncPayload(mockVaultData, mockPassphrase);
    const restoredData = await engine.decryptSyncPayload(payload, mockPassphrase);

    expect(restoredData.vaults[0].name).toBe('Perso Sync');
    expect(restoredData.credentials.length).toBe(1);
    expect(restoredData.credentials[0].title).toBe('Cloudflare Zero Trust');
    expect(restoredData.credentials[0].password).toBe('TopSecretPassword99!');
  });

  it('should fail decryption if provided an invalid passphrase', async () => {
    const payload = await engine.createEncryptedSyncPayload(mockVaultData, mockPassphrase);

    await expect(engine.decryptSyncPayload(payload, 'Wrong-Passphrase-Attempt-123')).rejects.toThrow();
  });
});
