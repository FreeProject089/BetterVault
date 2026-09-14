import type { Argon2Params } from '../import_export/encryptedExport';
import type { UnlockedVaultData } from '../types/vault';
import { createEmptyVaultData } from '../store/vaultStore';
import {
  ACCOUNT_KDF,
  InvalidRecoveryKeyError,
  WrongPasswordError,
  decryptVaultData,
  deriveAccountKeys,
  deriveRecoveryKeys,
  encryptVaultJson,
  exportVaultKey,
  fromBase64,
  generateRecoveryKey,
  generateVaultKey,
  importVaultKey,
  isValidEmail,
  normalizeEmail,
  parseRecoveryKey,
  rewrapVaultKey,
  toBase64,
  unwrapVaultKey,
  unwrapWithRecoveryKey,
  wrapVaultKey,
  type EncryptedBlob
} from './accountCrypto';
import { CloudClient, CloudError, type AccountInfo } from './cloudClient';
import { sanitizeLimits, type VaultLimits } from './limits';
import { mergeVaultData } from './merge';

async function createRecoveryMaterial(rawVaultKey: Uint8Array): Promise<{ recoveryKey: string; authHash: string; wrappedVaultKey: EncryptedBlob }> {
  const recoveryKey = generateRecoveryKey();
  const keys = await deriveRecoveryKeys(parseRecoveryKey(recoveryKey));
  return { recoveryKey, authHash: keys.authHash, wrappedVaultKey: await wrapVaultKey(keys.encKey, rawVaultKey) };
}

const browserLocale = () => ((globalThis.navigator?.language ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en');

export const MIN_MASTER_PASSWORD_LENGTH = 10;

const STORAGE_KEYS = {
  account: 'bettervault.account.v1',
  vault: 'bettervault.vault.v1',
  session: 'bettervault.session.v1'
} as const;

export type AccountMode = 'local' | 'cloud';

export interface AccountRecord {
  version: 1;
  email: string;
  mode: AccountMode;
  serverUrl?: string;
  kdf: Argon2Params;
  salt: string;
  wrappedVaultKey: EncryptedBlob;
  /** Clé du coffre chiffrée avec la clé de secours */
  recoveryWrappedVaultKey?: EncryptedBlob;
  /** Limites annoncées par le serveur (compte synchronisé) */
  limits?: VaultLimits;
  createdAt: number;
}

interface StoredVault {
  blob: EncryptedBlob;
  revision: number;
  dirty: boolean;
  updatedAt: number;
}

interface StoredSession {
  token: string | null;
  lastSyncAt: number | null;
}

export type SyncStatus = 'local' | 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  message?: string;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionKeyRecord {
  key: string;
  expiresAt: number;
}

/** Stockage mémoire de session (ex. chrome.storage.session) pour éviter de redériver la clé à chaque ouverture */
export interface SessionKeyStore {
  load(): Promise<SessionKeyRecord | null>;
  save(record: SessionKeyRecord): Promise<void>;
  clear(): Promise<void>;
}

export interface AccountServiceOptions {
  storage?: KeyValueStorage;
  kdf?: Argon2Params;
  pushDelayMs?: number;
  sessionStore?: SessionKeyStore;
  sessionTtlMs?: number;
  /** Langue des emails envoyés par le serveur */
  locale?: () => 'fr' | 'en';
}

export function assertPasswordStrength(password: string): void {
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new Error(`Le mot de passe principal doit contenir au moins ${MIN_MASTER_PASSWORD_LENGTH} caractères`);
  }
}

/**
 * Compte BetterVault : clés en mémoire uniquement pendant le déverrouillage,
 * coffre toujours chiffré sur l'appareil, synchronisation chiffrée optionnelle.
 */
export class AccountService {
  private readonly storage: KeyValueStorage;
  private readonly kdf: Argon2Params;
  private readonly pushDelayMs: number;
  private readonly sessionStore: SessionKeyStore | null;
  private readonly sessionTtlMs: number;
  private readonly locale: () => 'fr' | 'en';

  private vaultKey: CryptoKey | null = null;
  private authHash: string | null = null;
  private cloud: CloudClient | null = null;
  private latestData: UnlockedVaultData | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private saveCounter = 0;
  private syncPromise: Promise<void> | null = null;
  private syncRequested = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteDataHandler: ((data: UnlockedVaultData) => void) | null = null;
  private syncState: SyncState = { status: 'local', lastSyncAt: null };
  private readonly syncListeners = new Set<(state: SyncState) => void>();

  constructor(options: AccountServiceOptions = {}) {
    this.storage = options.storage ?? globalThis.localStorage;
    this.kdf = options.kdf ?? ACCOUNT_KDF;
    this.pushDelayMs = options.pushDelayMs ?? 1500;
    this.sessionStore = options.sessionStore ?? null;
    this.sessionTtlMs = options.sessionTtlMs ?? 15 * 60 * 1000;
    this.locale = options.locale ?? browserLocale;
    if (this.getAccount()?.mode === 'cloud') {
      this.syncState = {
        status: this.readStoredVault()?.dirty ? 'pending' : 'synced',
        lastSyncAt: this.readSession()?.lastSyncAt ?? null
      };
    }
  }

  /* ── État ───────────────────────────────────────────────────────────── */

  getAccount(): AccountRecord | null {
    return this.readJson<AccountRecord>(STORAGE_KEYS.account);
  }

  hasAccount(): boolean {
    return this.getAccount() !== null;
  }

  isUnlocked(): boolean {
    return this.vaultKey !== null;
  }

  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  onSyncStateChange(listener: (state: SyncState) => void): () => void {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  /** Appelé quand la synchronisation apporte des données distantes à charger dans l'interface */
  onRemoteData(handler: (data: UnlockedVaultData) => void): void {
    this.remoteDataHandler = handler;
  }

  /* ── Création / connexion / déverrouillage ─────────────────────────── */

  async createAccount(
    input: { email: string; password: string; mode: AccountMode; serverUrl?: string },
    initialData: UnlockedVaultData
  ): Promise<{ recoveryKey: string }> {
    if (this.hasAccount()) throw new Error('Un compte existe déjà sur cet appareil');
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) throw new Error('Adresse email invalide');
    assertPasswordStrength(input.password);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keys = await deriveAccountKeys(input.password, salt, this.kdf);
    const { key: vaultKey, raw } = await generateVaultKey(!!this.sessionStore);
    const wrappedVaultKey = await wrapVaultKey(keys.encKey, raw);
    const recovery = await createRecoveryMaterial(raw);
    raw.fill(0);
    const blob = await encryptVaultJson(vaultKey, JSON.stringify(initialData));

    const account: AccountRecord = {
      version: 1,
      email,
      mode: input.mode,
      kdf: { ...this.kdf },
      salt: toBase64(salt),
      wrappedVaultKey,
      recoveryWrappedVaultKey: recovery.wrappedVaultKey,
      createdAt: Date.now()
    };

    let revision = 0;
    if (input.mode === 'cloud') {
      if (!input.serverUrl) throw new Error('Adresse du serveur requise');
      const client = new CloudClient(input.serverUrl);
      const result = await client.register({
        email,
        authHash: keys.authHash,
        kdf: account.kdf,
        salt: account.salt,
        wrappedVaultKey,
        vault: blob,
        recovery: { authHash: recovery.authHash, wrappedVaultKey: recovery.wrappedVaultKey },
        locale: this.locale()
      });
      account.serverUrl = client.baseUrl;
      account.limits = await this.fetchLimits(client);
      revision = result.revision;
      this.cloud = client;
      this.writeSession({ token: result.token, lastSyncAt: Date.now() });
    }

    this.writeJson(STORAGE_KEYS.account, account);
    this.writeStoredVault({ blob, revision, dirty: false, updatedAt: Date.now() });
    this.vaultKey = vaultKey;
    this.authHash = keys.authHash;
    this.latestData = initialData;
    await this.rememberSession(vaultKey);
    this.setSyncState(input.mode === 'cloud' ? { status: 'synced', lastSyncAt: Date.now() } : { status: 'local', lastSyncAt: null });
    return { recoveryKey: recovery.recoveryKey };
  }

  /**
   * Connexion à un compte synchronisé existant.
   * Si la double authentification est activée, le premier appel échoue avec le code « totp_required » (voir isTotpRequired).
   */
  async signIn(serverUrl: string, emailInput: string, password: string, totp?: string): Promise<UnlockedVaultData> {
    if (this.hasAccount()) throw new Error('Déconnectez le compte actuel de cet appareil avant d’en utiliser un autre');
    const email = normalizeEmail(emailInput);
    if (!isValidEmail(email)) throw new Error('Adresse email invalide');

    const client = new CloudClient(serverUrl);
    const pre = await client.prelogin(email);
    const keys = await deriveAccountKeys(password, fromBase64(pre.salt), pre.kdf);

    let session;
    try {
      session = await client.login(email, keys.authHash, { totp: totp?.replace(/\s/g, '') || undefined, locale: this.locale() });
    } catch (err) {
      if (err instanceof CloudError && err.status === 401 && err.code === 'invalid_credentials') throw new WrongPasswordError('Email ou mot de passe incorrect');
      throw err;
    }

    const vaultKey = await unwrapVaultKey(keys.encKey, session.wrappedVaultKey, !!this.sessionStore);
    const remote = await client.getVault();
    if (!remote.blob) throw new Error('Coffre distant introuvable');
    const data = await decryptVaultData<UnlockedVaultData>(vaultKey, remote.blob);

    const account: AccountRecord = {
      version: 1,
      email,
      mode: 'cloud',
      serverUrl: client.baseUrl,
      kdf: session.kdf,
      salt: session.salt,
      wrappedVaultKey: session.wrappedVaultKey,
      limits: await this.fetchLimits(client),
      createdAt: Date.now()
    };
    this.writeJson(STORAGE_KEYS.account, account);
    this.writeStoredVault({ blob: remote.blob, revision: remote.revision, dirty: false, updatedAt: Date.now() });
    this.writeSession({ token: session.token, lastSyncAt: Date.now() });

    this.cloud = client;
    this.vaultKey = vaultKey;
    this.authHash = keys.authHash;
    this.latestData = data;
    await this.rememberSession(vaultKey);
    this.setSyncState({ status: 'synced', lastSyncAt: Date.now() });
    return data;
  }

  async unlock(password: string): Promise<UnlockedVaultData> {
    const account = this.getAccount();
    if (!account) throw new Error('Aucun compte sur cet appareil');

    const keys = await deriveAccountKeys(password, fromBase64(account.salt), account.kdf);
    const vaultKey = await unwrapVaultKey(keys.encKey, account.wrappedVaultKey, !!this.sessionStore);
    const stored = this.readStoredVault();
    if (!stored) throw new Error('Données du coffre introuvables sur cet appareil');
    const data = await decryptVaultData<UnlockedVaultData>(vaultKey, stored.blob);

    this.vaultKey = vaultKey;
    this.authHash = keys.authHash;
    this.latestData = data;
    if (account.mode === 'cloud' && account.serverUrl) {
      this.cloud = new CloudClient(account.serverUrl, this.readSession()?.token ?? null);
    }
    await this.rememberSession(vaultKey);
    return data;
  }

  /** Reprend une session encore valide (extension) sans redemander le mot de passe principal */
  async resumeSession(): Promise<UnlockedVaultData | null> {
    if (!this.sessionStore) return null;
    const account = this.getAccount();
    const stored = this.readStoredVault();
    const session = await this.sessionStore.load();
    if (!account || !stored || !session || session.expiresAt <= Date.now()) {
      await this.sessionStore.clear();
      return null;
    }

    try {
      const vaultKey = await importVaultKey(fromBase64(session.key), true);
      const data = await decryptVaultData<UnlockedVaultData>(vaultKey, stored.blob);
      this.vaultKey = vaultKey;
      this.latestData = data;
      if (account.mode === 'cloud' && account.serverUrl) {
        this.cloud = new CloudClient(account.serverUrl, this.readSession()?.token ?? null);
      }
      await this.sessionStore.save({ key: session.key, expiresAt: Date.now() + this.sessionTtlMs });
      return data;
    } catch {
      await this.sessionStore.clear();
      return null;
    }
  }

  private async rememberSession(vaultKey: CryptoKey): Promise<void> {
    if (!this.sessionStore || !vaultKey.extractable) return;
    const raw = await exportVaultKey(vaultKey);
    try {
      await this.sessionStore.save({ key: toBase64(raw), expiresAt: Date.now() + this.sessionTtlMs });
    } finally {
      raw.fill(0);
    }
  }

  lock(): void {
    void this.sessionStore?.clear();
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.vaultKey = null;
    this.authHash = null;
    this.latestData = null;
    this.cloud = null;
  }

  /* ── Enregistrement & synchronisation ──────────────────────────────── */

  save(data: UnlockedVaultData): Promise<void> {
    const vaultKey = this.vaultKey;
    if (!vaultKey) return Promise.reject(new Error('Coffre verrouillé'));

    const json = JSON.stringify(data);
    this.latestData = JSON.parse(json) as UnlockedVaultData;
    this.saveCounter++;
    const isCloud = this.getAccount()?.mode === 'cloud';

    this.saveChain = this.saveChain
      .then(async () => {
        const blob = await encryptVaultJson(vaultKey, json);
        const stored = this.readStoredVault();
        this.writeStoredVault({ blob, revision: stored?.revision ?? 0, dirty: isCloud, updatedAt: Date.now() });
      })
      .catch(err => {
        this.setSyncState({ ...this.syncState, status: 'error', message: `Enregistrement impossible : ${err instanceof Error ? err.message : err}` });
      });

    if (isCloud) {
      this.setSyncState({ ...this.syncState, status: 'pending', message: undefined });
      this.schedulePush();
    }
    return this.saveChain;
  }

  flush(): Promise<void> {
    return this.saveChain;
  }

  syncNow(): Promise<void> {
    if (this.syncPromise) {
      // Une synchronisation tourne déjà : on en relancera une à la fin pour inclure les nouveaux changements
      this.syncRequested = true;
      return this.syncPromise;
    }
    this.syncPromise = this.runSync().finally(() => {
      this.syncPromise = null;
      if (this.syncRequested) {
        this.syncRequested = false;
        void this.syncNow();
      }
    });
    return this.syncPromise;
  }

  private schedulePush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.syncNow();
    }, this.pushDelayMs);
  }

  private async runSync(): Promise<void> {
    const account = this.getAccount();
    if (!account || account.mode !== 'cloud' || !this.vaultKey || !this.cloud) return;

    // Toutes les sauvegardes en cours doivent être écrites avant de figer l'état local
    let pendingCounter: number;
    do {
      pendingCounter = this.saveCounter;
      await this.saveChain;
    } while (pendingCounter !== this.saveCounter);
    if (!this.vaultKey || !this.cloud) return;

    const vaultKey = this.vaultKey;
    const cloud = this.cloud;
    const stored = this.readStoredVault();
    if (!stored) return;
    const startCounter = this.saveCounter;

    this.setSyncState({ ...this.syncState, status: 'syncing', message: undefined });

    try {
      const outcome = await this.withSessionRetry(async () => {
        let data = await decryptVaultData<UnlockedVaultData>(vaultKey, stored.blob);
        let blob = stored.blob;
        let revision = stored.revision;
        let dirty = stored.dirty;
        let changedByRemote = false;

        const remote = await cloud.getVault();
        if (remote.blob && remote.revision !== revision) {
          const remoteData = await decryptVaultData<UnlockedVaultData>(vaultKey, remote.blob);
          if (dirty) {
            data = mergeVaultData(data, remoteData);
          } else {
            data = remoteData;
            blob = remote.blob;
          }
          revision = remote.revision;
          changedByRemote = true;
        }

        for (let attempt = 0; dirty && attempt < 5; attempt++) {
          blob = await encryptVaultJson(vaultKey, JSON.stringify(data));
          try {
            revision = (await cloud.putVault(revision, blob)).revision;
            dirty = false;
          } catch (err) {
            const conflict = err instanceof CloudError && err.status === 409
              ? err.details as { revision: number; blob: EncryptedBlob } | undefined
              : undefined;
            if (!conflict?.blob) throw err;
            data = mergeVaultData(data, await decryptVaultData<UnlockedVaultData>(vaultKey, conflict.blob));
            revision = conflict.revision;
            changedByRemote = true;
          }
        }
        if (dirty) throw new Error('Conflits de synchronisation répétés, réessayez');
        return { data, blob, revision, changedByRemote };
      });

      const now = Date.now();
      const changedLocally = this.saveCounter !== startCounter;
      if (changedLocally) {
        // Des modifications ont été enregistrées pendant la synchronisation : elles seront renvoyées
        const latest = this.readStoredVault();
        if (latest) this.writeStoredVault({ ...latest, revision: outcome.revision, dirty: true });
      } else {
        this.writeStoredVault({ blob: outcome.blob, revision: outcome.revision, dirty: false, updatedAt: now });
      }
      this.writeSession({ token: cloud.getToken(), lastSyncAt: now });

      if (outcome.changedByRemote) {
        const finalData = changedLocally && this.latestData ? mergeVaultData(this.latestData, outcome.data) : outcome.data;
        this.latestData = finalData;
        this.remoteDataHandler?.(finalData);
        if (changedLocally) void this.save(finalData);
      } else if (changedLocally) {
        this.schedulePush();
      }

      const stillPending = changedLocally || !!this.readStoredVault()?.dirty;
      this.setSyncState({ status: stillPending ? 'pending' : 'synced', lastSyncAt: now });
    } catch (err) {
      const offline = err instanceof CloudError && err.code === 'network';
      this.setSyncState({
        ...this.syncState,
        status: offline ? 'offline' : 'error',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  private async withSessionRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      const account = this.getAccount();
      if (!(err instanceof CloudError) || err.status !== 401 || !this.authHash || !this.cloud || !account) throw err;
      let session;
      try {
        session = await this.cloud.login(account.email, this.authHash, { notify: false });
      } catch (loginErr) {
        if (loginErr instanceof CloudError && loginErr.code === 'totp_required') {
          throw new CloudError('Session expirée : saisissez un code de votre application d’authentification pour reprendre la synchronisation.', 401, 'totp_required');
        }
        if (loginErr instanceof CloudError && loginErr.status === 401) {
          throw new CloudError(
            'Le mot de passe principal a été modifié sur un autre appareil. Déconnectez-vous de cet appareil puis reconnectez-vous avec le nouveau mot de passe.',
            401,
            'password_changed'
          );
        }
        throw loginErr;
      }
      this.writeSession({ token: session.token, lastSyncAt: this.readSession()?.lastSyncAt ?? null });
      return operation();
    }
  }

  /* ── Gestion du compte ─────────────────────────────────────────────── */

  /** Change le mot de passe principal : seule la clé du coffre est re-chiffrée, le coffre reste inchangé */
  async changeMasterPassword(currentPassword: string, newPassword: string): Promise<void> {
    const account = this.getAccount();
    if (!account) throw new Error('Aucun compte sur cet appareil');
    if (!this.vaultKey) throw new Error('Coffre verrouillé');
    assertPasswordStrength(newPassword);
    if (currentPassword === newPassword) throw new Error('Le nouveau mot de passe doit être différent de l’actuel');

    const oldKeys = await deriveAccountKeys(currentPassword, fromBase64(account.salt), account.kdf);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const newKeys = await deriveAccountKeys(newPassword, salt, this.kdf);
    const wrappedVaultKey = await rewrapVaultKey(oldKeys.encKey, account.wrappedVaultKey, newKeys.encKey);
    const updated: AccountRecord = { ...account, kdf: { ...this.kdf }, salt: toBase64(salt), wrappedVaultKey };

    if (account.mode === 'cloud' && account.serverUrl) {
      const client = this.cloud ?? new CloudClient(account.serverUrl, this.readSession()?.token ?? null);
      await this.withSessionRetry(() => client.changePassword({
        currentAuthHash: oldKeys.authHash,
        newAuthHash: newKeys.authHash,
        kdf: updated.kdf,
        salt: updated.salt,
        wrappedVaultKey
      }));
    }

    this.writeJson(STORAGE_KEYS.account, updated);
    this.authHash = newKeys.authHash;
  }

  /** Passe un compte local en compte synchronisé en envoyant le coffre chiffré existant ; une nouvelle clé de secours est créée */
  async connectCloud(serverUrl: string, password: string): Promise<{ recoveryKey: string }> {
    const account = this.getAccount();
    if (!account) throw new Error('Aucun compte sur cet appareil');
    if (account.mode === 'cloud') throw new Error('Ce compte est déjà synchronisé');

    const keys = await deriveAccountKeys(password, fromBase64(account.salt), account.kdf);
    const exportable = await unwrapVaultKey(keys.encKey, account.wrappedVaultKey, true);
    const raw = await exportVaultKey(exportable);
    const recovery = await createRecoveryMaterial(raw);
    raw.fill(0);
    await this.saveChain;
    const stored = this.readStoredVault();
    if (!stored) throw new Error('Données du coffre introuvables sur cet appareil');

    const client = new CloudClient(serverUrl);
    const result = await client.register({
      email: account.email,
      authHash: keys.authHash,
      kdf: account.kdf,
      salt: account.salt,
      wrappedVaultKey: account.wrappedVaultKey,
      vault: stored.blob,
      recovery: { authHash: recovery.authHash, wrappedVaultKey: recovery.wrappedVaultKey },
      locale: this.locale()
    });

    this.writeJson(STORAGE_KEYS.account, {
      ...account,
      mode: 'cloud',
      serverUrl: client.baseUrl,
      recoveryWrappedVaultKey: recovery.wrappedVaultKey,
      limits: await this.fetchLimits(client)
    });
    this.writeStoredVault({ ...stored, revision: result.revision, dirty: false });
    this.writeSession({ token: result.token, lastSyncAt: Date.now() });
    this.cloud = client;
    this.authHash = keys.authHash;
    this.setSyncState({ status: 'synced', lastSyncAt: Date.now() });
    return { recoveryKey: recovery.recoveryKey };
  }

  /* ── Limites, double authentification, clé de secours ──────────────── */

  getLimits(): VaultLimits {
    return sanitizeLimits(this.getAccount()?.limits);
  }

  private async fetchLimits(client: CloudClient): Promise<VaultLimits | undefined> {
    try {
      return sanitizeLimits((await client.config()).limits);
    } catch {
      return undefined;
    }
  }

  /** Relit les limites du serveur (elles peuvent changer depuis la page d'administration) */
  async refreshLimits(): Promise<VaultLimits> {
    const account = this.getAccount();
    if (account?.mode === 'cloud' && account.serverUrl) {
      const limits = await this.fetchLimits(this.cloud ?? new CloudClient(account.serverUrl));
      const latest = this.getAccount();
      if (limits && latest) this.writeJson(STORAGE_KEYS.account, { ...latest, limits });
    }
    return this.getLimits();
  }

  private cloudClient(): CloudClient {
    const account = this.getAccount();
    if (!account || account.mode !== 'cloud' || !account.serverUrl) throw new Error('Cette fonction demande un compte synchronisé');
    if (!this.cloud) this.cloud = new CloudClient(account.serverUrl, this.readSession()?.token ?? null);
    return this.cloud;
  }

  private async verifyPassword(password: string): Promise<{ authHash: string; encKey: CryptoKey; account: AccountRecord }> {
    const account = this.getAccount();
    if (!account) throw new Error('Aucun compte sur cet appareil');
    const keys = await deriveAccountKeys(password, fromBase64(account.salt), account.kdf);
    await unwrapVaultKey(keys.encKey, account.wrappedVaultKey);
    return { ...keys, account };
  }

  getCloudAccountInfo(): Promise<AccountInfo> {
    const client = this.cloudClient();
    return this.withSessionRetry(() => client.me());
  }

  /** Première étape : le serveur crée un secret à scanner dans l'application d'authentification */
  async beginTotpSetup(password: string): Promise<{ secret: string; uri: string }> {
    const client = this.cloudClient();
    const { authHash } = await this.verifyPassword(password);
    return this.withSessionRetry(() => client.setupTotp(authHash));
  }

  /** Seconde étape : le code affiché par l'application confirme la configuration */
  async enableTotp(code: string): Promise<void> {
    const client = this.cloudClient();
    await this.withSessionRetry(() => client.enableTotp(code.replace(/\s/g, '')));
  }

  async disableTotp(password: string, code: string): Promise<void> {
    const client = this.cloudClient();
    const { authHash } = await this.verifyPassword(password);
    await this.withSessionRetry(() => client.disableTotp(authHash, code.replace(/\s/g, '')));
  }

  /** Nouvelle session quand l'ancienne a expiré sur un compte protégé par la double authentification */
  async reauthenticate(totp: string): Promise<void> {
    const account = this.getAccount();
    if (!account || !this.authHash) throw new Error('Déverrouillez le coffre d’abord');
    const client = this.cloudClient();
    const session = await client.login(account.email, this.authHash, { totp: totp.replace(/\s/g, ''), notify: false });
    this.writeSession({ token: session.token, lastSyncAt: this.readSession()?.lastSyncAt ?? null });
    await this.syncNow();
  }

  hasRecoveryKey(): boolean {
    return !!this.getAccount()?.recoveryWrappedVaultKey;
  }

  /** Crée une nouvelle clé de secours ; l'ancienne cesse de fonctionner */
  async regenerateRecoveryKey(password: string): Promise<string> {
    const { authHash, encKey, account } = await this.verifyPassword(password);
    const exportable = await unwrapVaultKey(encKey, account.wrappedVaultKey, true);
    const raw = await exportVaultKey(exportable);
    const recovery = await createRecoveryMaterial(raw);
    raw.fill(0);

    if (account.mode === 'cloud') {
      const client = this.cloudClient();
      await this.withSessionRetry(() => client.setRecovery(authHash, { authHash: recovery.authHash, wrappedVaultKey: recovery.wrappedVaultKey }));
    }
    this.writeJson(STORAGE_KEYS.account, { ...this.getAccount()!, recoveryWrappedVaultKey: recovery.wrappedVaultKey });
    return recovery.recoveryKey;
  }

  /** Mot de passe oublié sur un compte local : la clé de secours ouvre le coffre et un nouveau mot de passe le protège */
  async recoverLocalAccount(recoveryKeyInput: string, newPassword: string): Promise<UnlockedVaultData> {
    const account = this.getAccount();
    if (!account) throw new Error('Aucun compte sur cet appareil');
    if (!account.recoveryWrappedVaultKey) throw new InvalidRecoveryKeyError('Ce compte n’a pas de clé de secours');
    assertPasswordStrength(newPassword);

    const recoveryKeys = await deriveRecoveryKeys(parseRecoveryKey(recoveryKeyInput));
    const exportable = await unwrapWithRecoveryKey(recoveryKeys.encKey, account.recoveryWrappedVaultKey, true);
    const stored = this.readStoredVault();
    if (!stored) throw new Error('Données du coffre introuvables sur cet appareil');
    const data = await decryptVaultData<UnlockedVaultData>(exportable, stored.blob);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keys = await deriveAccountKeys(newPassword, salt, this.kdf);
    const raw = await exportVaultKey(exportable);
    const wrappedVaultKey = await wrapVaultKey(keys.encKey, raw);
    const vaultKey = await importVaultKey(raw, !!this.sessionStore);
    raw.fill(0);

    this.writeJson(STORAGE_KEYS.account, { ...account, kdf: { ...this.kdf }, salt: toBase64(salt), wrappedVaultKey });
    this.vaultKey = vaultKey;
    this.authHash = keys.authHash;
    this.latestData = data;
    if (account.mode === 'cloud' && account.serverUrl) {
      this.cloud = new CloudClient(account.serverUrl, this.readSession()?.token ?? null);
    }
    await this.rememberSession(vaultKey);
    return data;
  }

  /** Demande l'envoi du code de réinitialisation par email (si le serveur a un SMTP) */
  requestRecoveryCode(serverUrl: string, email: string): Promise<{ emailCodeRequired: boolean }> {
    return new CloudClient(serverUrl).recoveryStart(normalizeEmail(email), this.locale());
  }

  /**
   * Mot de passe oublié sur un compte synchronisé.
   * Avec la clé de secours, le coffre est conservé ; sans elle, il est remplacé par un coffre vide et une nouvelle clé de secours est créée.
   * Le serveur exige le code email (si SMTP) et le code de l'application d'authentification (si activée).
   */
  async recoverCloudAccount(input: {
    serverUrl: string;
    email: string;
    newPassword: string;
    recoveryKey?: string;
    emailCode?: string;
    totp?: string;
  }): Promise<{ data: UnlockedVaultData; newRecoveryKey: string | null; vaultReset: boolean }> {
    const email = normalizeEmail(input.email);
    const existing = this.getAccount();
    if (existing && existing.email !== email) throw new Error('Un autre compte est ouvert sur cet appareil. Retirez-le d’abord.');
    assertPasswordStrength(input.newPassword);

    const client = new CloudClient(input.serverUrl);
    const recoveryKeys = input.recoveryKey?.trim() ? await deriveRecoveryKeys(parseRecoveryKey(input.recoveryKey)) : null;
    const verified = await client.recoveryVerify({
      email,
      recoveryAuthHash: recoveryKeys?.authHash,
      emailCode: input.emailCode?.replace(/\s/g, '') || undefined,
      totp: input.totp?.replace(/\s/g, '') || undefined
    });

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keys = await deriveAccountKeys(input.newPassword, salt, this.kdf);
    const extractable = !!this.sessionStore;
    let vaultKey: CryptoKey;
    let wrappedVaultKey: EncryptedBlob;
    let recoveryWrappedVaultKey: EncryptedBlob;
    let newRecovery: Awaited<ReturnType<typeof createRecoveryMaterial>> | null = null;
    let vault: EncryptedBlob | undefined;

    if (verified.withRecoveryKey && recoveryKeys && verified.wrappedVaultKey) {
      const exportable = await unwrapWithRecoveryKey(recoveryKeys.encKey, verified.wrappedVaultKey, true);
      const raw = await exportVaultKey(exportable);
      wrappedVaultKey = await wrapVaultKey(keys.encKey, raw);
      vaultKey = await importVaultKey(raw, extractable);
      raw.fill(0);
      recoveryWrappedVaultKey = verified.wrappedVaultKey;
    } else {
      const generated = await generateVaultKey(extractable);
      vaultKey = generated.key;
      wrappedVaultKey = await wrapVaultKey(keys.encKey, generated.raw);
      newRecovery = await createRecoveryMaterial(generated.raw);
      generated.raw.fill(0);
      recoveryWrappedVaultKey = newRecovery.wrappedVaultKey;
      vault = await encryptVaultJson(vaultKey, JSON.stringify(createEmptyVaultData()));
    }

    await client.recoveryComplete({
      token: verified.token,
      authHash: keys.authHash,
      kdf: { ...this.kdf },
      salt: toBase64(salt),
      wrappedVaultKey,
      recovery: newRecovery ? { authHash: newRecovery.authHash, wrappedVaultKey: newRecovery.wrappedVaultKey } : undefined,
      vault
    });

    const remote = await client.getVault();
    if (!remote.blob) throw new Error('Coffre distant introuvable');
    const data = await decryptVaultData<UnlockedVaultData>(vaultKey, remote.blob);

    this.writeJson(STORAGE_KEYS.account, {
      version: 1,
      email,
      mode: 'cloud',
      serverUrl: client.baseUrl,
      kdf: { ...this.kdf },
      salt: toBase64(salt),
      wrappedVaultKey,
      recoveryWrappedVaultKey,
      limits: await this.fetchLimits(client),
      createdAt: existing?.createdAt ?? Date.now()
    } satisfies AccountRecord);
    this.writeStoredVault({ blob: remote.blob, revision: remote.revision, dirty: false, updatedAt: Date.now() });
    this.writeSession({ token: client.getToken(), lastSyncAt: Date.now() });

    this.cloud = client;
    this.vaultKey = vaultKey;
    this.authHash = keys.authHash;
    this.latestData = data;
    await this.rememberSession(vaultKey);
    this.setSyncState({ status: 'synced', lastSyncAt: Date.now() });
    return { data, newRecoveryKey: newRecovery?.recoveryKey ?? null, vaultReset: !verified.withRecoveryKey };
  }

  /** Supprime le compte du serveur ; les données restent sur cet appareil en compte local */
  async deleteCloudAccount(password: string): Promise<void> {
    const account = this.getAccount();
    if (!account || account.mode !== 'cloud' || !account.serverUrl) throw new Error('Aucun compte synchronisé');
    const keys = await deriveAccountKeys(password, fromBase64(account.salt), account.kdf);
    await unwrapVaultKey(keys.encKey, account.wrappedVaultKey);

    const client = this.cloud ?? new CloudClient(account.serverUrl, this.readSession()?.token ?? null);
    await this.withSessionRetry(() => client.deleteAccount(keys.authHash));

    const { serverUrl: _serverUrl, ...localAccount } = account;
    this.writeJson(STORAGE_KEYS.account, { ...localAccount, mode: 'local' });
    const stored = this.readStoredVault();
    if (stored) this.writeStoredVault({ ...stored, revision: 0, dirty: false });
    this.storage.removeItem(STORAGE_KEYS.session);
    this.cloud = null;
    this.setSyncState({ status: 'local', lastSyncAt: null });
  }

  /** Retire le compte et toutes ses données chiffrées de cet appareil */
  async signOut(): Promise<void> {
    if (this.getAccount()?.mode === 'cloud' && this.cloud) {
      try {
        await this.cloud.logout();
      } catch {
        // Session déjà expirée ou serveur hors ligne : la suppression locale suffit
      }
    }
    this.lock();
    Object.values(STORAGE_KEYS).forEach(key => this.storage.removeItem(key));
    this.setSyncState({ status: 'local', lastSyncAt: null });
  }

  /* ── Stockage ──────────────────────────────────────────────────────── */

  private setSyncState(state: SyncState): void {
    this.syncState = state;
    this.syncListeners.forEach(listener => listener({ ...state }));
  }

  private readJson<T>(key: string): T | null {
    try {
      const raw = this.storage.getItem(key);
      return raw ? JSON.parse(raw) as T : null;
    } catch {
      return null;
    }
  }

  private writeJson(key: string, value: unknown): void {
    this.storage.setItem(key, JSON.stringify(value));
  }

  private readStoredVault(): StoredVault | null {
    return this.readJson<StoredVault>(STORAGE_KEYS.vault);
  }

  private writeStoredVault(vault: StoredVault): void {
    this.writeJson(STORAGE_KEYS.vault, vault);
  }

  private readSession(): StoredSession | null {
    return this.readJson<StoredSession>(STORAGE_KEYS.session);
  }

  private writeSession(session: StoredSession): void {
    this.writeJson(STORAGE_KEYS.session, session);
  }
}
