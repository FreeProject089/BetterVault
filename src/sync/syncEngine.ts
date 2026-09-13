import { UnlockedVaultData, EncryptedVaultPayload } from '../types/vault';
import { deriveMasterKey, encryptVault, decryptVault } from '../crypto/vaultCrypto';

export interface SyncConfig {
  enabled: boolean;
  endpointUrl: string; // URL serveur WebDAV, CouchDB, ou API REST chiffrée
  lastSyncTimestamp?: number;
  status: 'idle' | 'syncing' | 'success' | 'error';
}

const SYNC_CONFIG_KEY = 'bum_sync_config_v1';

export class SyncEngine {
  private config: SyncConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  public getConfig(): SyncConfig {
    return { ...this.config };
  }

  public updateConfig(partial: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...partial };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(this.config));
  }

  private loadConfig(): SyncConfig {
    try {
      const stored = localStorage.getItem(SYNC_CONFIG_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      // Ignorer
    }
    return {
      enabled: false,
      endpointUrl: '',
      status: 'idle'
    };
  }

  /**
   * Prépare le paquet chiffré Zero-Knowledge prêt à être envoyé au relais distant
   */
  public async createEncryptedSyncPayload(data: UnlockedVaultData, passphrase: string): Promise<EncryptedVaultPayload> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const masterKey = await deriveMasterKey(passphrase, salt);
    return await encryptVault(data, masterKey, salt);
  }

  /**
   * Déchiffre et intègre un paquet reçu depuis un relais distant
   */
  public async decryptSyncPayload(payload: EncryptedVaultPayload, passphrase: string): Promise<UnlockedVaultData> {
    const saltBytes = Uint8Array.from(atob(payload.salt), c => c.charCodeAt(0));
    const masterKey = await deriveMasterKey(passphrase, saltBytes);
    return await decryptVault(payload, masterKey);
  }

  /**
   * Simule ou effectue la synchronisation vers le serveur de relais distant (E2EE)
   */
  public async syncWithRemote(data: UnlockedVaultData, passphrase: string): Promise<{ success: boolean; message: string }> {
    if (!this.config.enabled || !this.config.endpointUrl) {
      return { success: false, message: 'Synchronisation non configurée.' };
    }

    this.config.status = 'syncing';
    try {
      const encryptedPayload = await this.createEncryptedSyncPayload(data, passphrase);

      const response = await fetch(this.config.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client': 'BUM-Vault-Pro-E2EE'
        },
        body: JSON.stringify(encryptedPayload)
      });

      if (!response.ok) {
        throw new Error(`Serveur HTTP ${response.status}: ${response.statusText}`);
      }

      this.config.lastSyncTimestamp = Date.now();
      this.config.status = 'success';
      this.updateConfig(this.config);

      return { success: true, message: 'Coffre synchronisé de bout en bout (E2EE)' };
    } catch (err: any) {
      this.config.status = 'error';
      this.updateConfig(this.config);
      return { success: false, message: `Échec de synchro : ${err.message || err}` };
    }
  }
}

export const syncEngine = new SyncEngine();
