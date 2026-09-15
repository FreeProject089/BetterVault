import type { CredentialItem, SharedVaultInfo, TagDef, Task, UnlockedVaultData, VaultMetadata } from '../types/vault';
import type { AccountService } from './accountService';
import { decryptVaultData, encryptVaultJson, fromBase64, importVaultKey } from './accountCrypto';
import { CloudError, type SharedMembers, type SharedPermission, type SharedRole, type SharedVaultSummary } from './cloudClient';
import { mergeVaultData } from './merge';
import { keyFingerprint, openSealed, sealForRecipient } from './sharingCrypto';

/**
 * Coffres partagés côté application.
 *
 * L'interface travaille sur un seul jeu de données : le coffre personnel plus les coffres partagés (mergeInto).
 * À l'enregistrement, split() rend la partie personnelle et envoie chaque coffre partagé modifié à part.
 */

export interface SharedVaultContent {
  vault: { name: string; type: VaultMetadata['type']; icon?: VaultMetadata['icon']; createdAt: number; updatedAt: number };
  credentials: CredentialItem[];
  tasks: Task[];
  tagDefs: TagDef[];
  deleted: Record<string, number>;
}

interface SharedState {
  summary: SharedVaultSummary;
  key: Uint8Array | null;
  revision: number;
  content: SharedVaultContent | null;
  savedJson: string;
  saving: Promise<void> | null;
  pendingJson: string | null;
}

const randomKey = () => crypto.getRandomValues(new Uint8Array(32));

export class SharedReadOnlyError extends Error {
  constructor() {
    super('Votre rôle dans ce coffre partagé ne permet pas de le modifier');
    this.name = 'SharedReadOnlyError';
  }
}

function asVaultData(content: SharedVaultContent): UnlockedVaultData {
  return { vaults: [], activeVaultId: '', credentials: content.credentials, tasks: content.tasks, tagDefs: content.tagDefs, deleted: content.deleted };
}

function emptyContent(name: string, type: VaultMetadata['type'], icon?: VaultMetadata['icon']): SharedVaultContent {
  const now = Date.now();
  return { vault: { name, type, icon, createdAt: now, updatedAt: now }, credentials: [], tasks: [], tagDefs: [], deleted: {} };
}

export class SharedVaultManager {
  private readonly account: AccountService;
  private readonly states = new Map<string, SharedState>();
  private readonly listeners = new Set<() => void>();
  private lastPersonalVaultId = '';
  private myUserId: string | null = null;
  private errorHandler: ((vaultId: string, err: unknown) => void) | null = null;

  constructor(account: AccountService) {
    this.account = account;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onSaveError(handler: (vaultId: string, err: unknown) => void): void {
    this.errorHandler = handler;
  }

  private emit(): void {
    this.listeners.forEach(listener => listener());
  }

  isAvailable(): boolean {
    return this.account.isCloud() && this.account.isUnlocked();
  }

  invitations(): SharedVaultSummary[] {
    return [...this.states.values()].filter(s => s.summary.status === 'invited').map(s => s.summary);
  }

  summary(vaultId: string): SharedVaultSummary | undefined {
    return this.states.get(vaultId)?.summary;
  }

  can(vaultId: string, permission: SharedPermission): boolean {
    const state = this.states.get(vaultId);
    return !state || state.summary.role.permissions.includes(permission);
  }

  isShared(vaultId: string): boolean {
    return this.states.has(vaultId);
  }

  /** Recharge la liste et le contenu des coffres modifiés depuis la dernière lecture */
  async refresh(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    const summaries = await this.account.withCloud(client => client.listSharedVaults());
    const { privateKey } = await this.account.getSharingKeys();
    let changed = false;

    for (const id of [...this.states.keys()]) {
      if (!summaries.some(s => s.id === id)) {
        this.states.get(id)?.key?.fill(0);
        this.states.delete(id);
        changed = true;
      }
    }

    for (const summary of summaries) {
      const previous = this.states.get(summary.id);
      if (summary.status === 'invited') {
        if (!previous || previous.summary.status !== 'invited') changed = true;
        this.states.set(summary.id, { summary, key: null, revision: 0, content: null, savedJson: '', saving: null, pendingJson: null });
        continue;
      }

      const keyChanged = !previous || previous.summary.wrappedKey !== summary.wrappedKey || !previous.key;
      const roleChanged = !!previous && JSON.stringify(previous.summary.role) !== JSON.stringify(summary.role);
      if (!keyChanged && previous!.revision === summary.revision && previous!.content) {
        previous!.summary = summary;
        if (roleChanged) changed = true;
        continue;
      }

      const key = keyChanged ? await openSealed(summary.wrappedKey, privateKey) : previous!.key!;
      const remote = await this.account.withCloud(client => client.getSharedVault(summary.id));
      if (!remote.blob) continue;
      const content = await decryptVaultData<SharedVaultContent>(await importVaultKey(key), remote.blob);
      if (keyChanged) previous?.key?.fill(0);
      const json = JSON.stringify(content);
      this.states.set(summary.id, { summary, key, revision: remote.revision, content, savedJson: json, saving: previous?.saving ?? null, pendingJson: null });
      changed = true;
    }

    if (changed) this.emit();
    return changed;
  }

  /** Données affichées : coffre personnel + coffres partagés actifs */
  mergeInto(personal: UnlockedVaultData): UnlockedVaultData {
    const merged: UnlockedVaultData = {
      ...personal,
      vaults: [...personal.vaults],
      credentials: [...personal.credentials],
      tasks: [...personal.tasks],
      tagDefs: [...personal.tagDefs]
    };
    const knownTags = new Set(merged.tagDefs.map(t => t.name.toLowerCase()));

    for (const state of this.states.values()) {
      if (!state.content) continue;
      const { vault } = state.content;
      const shared: SharedVaultInfo = { role: state.summary.role, ownerEmail: state.summary.ownerEmail };
      merged.vaults.push({ id: state.summary.id, name: vault.name, type: vault.type, icon: vault.icon, createdAt: vault.createdAt, updatedAt: vault.updatedAt, shared });
      merged.credentials.push(...state.content.credentials.map(c => ({ ...c, vaultId: state.summary.id })));
      merged.tasks.push(...state.content.tasks.map(t => ({ ...t, vaultId: state.summary.id })));
      for (const tag of state.content.tagDefs) {
        if (!knownTags.has(tag.name.toLowerCase())) {
          knownTags.add(tag.name.toLowerCase());
          merged.tagDefs.push(tag);
        }
      }
    }
    return merged;
  }

  /**
   * Sépare les données de l'interface : renvoie la partie personnelle et, si demandé,
   * envoie les coffres partagés modifiés (seulement ceux où le rôle permet d'écrire).
   */
  split(data: UnlockedVaultData, options: { save: boolean } = { save: true }): UnlockedVaultData {
    const sharedIds = new Set(this.states.keys());
    const personalVaults = data.vaults.filter(v => !sharedIds.has(v.id)).map(({ shared: _shared, ...vault }) => vault);
    if (!sharedIds.has(data.activeVaultId)) this.lastPersonalVaultId = data.activeVaultId;

    const personal: UnlockedVaultData = {
      vaults: personalVaults,
      activeVaultId: sharedIds.has(data.activeVaultId) ? (this.lastPersonalVaultId || personalVaults[0]?.id || '') : data.activeVaultId,
      credentials: data.credentials.filter(c => !sharedIds.has(c.vaultId)),
      tasks: data.tasks.filter(t => !sharedIds.has(t.vaultId)),
      tagDefs: data.tagDefs,
      deleted: data.deleted
    };

    if (options.save) {
      for (const state of this.states.values()) {
        if (!state.content) continue;
        const id = state.summary.id;
        const meta = data.vaults.find(v => v.id === id);
        if (!meta) continue;
        const credentials = data.credentials.filter(c => c.vaultId === id);
        const tasks = data.tasks.filter(t => t.vaultId === id);
        const previousIds = new Set([...state.content.credentials, ...state.content.tasks].map(item => item.id));
        const deleted = Object.fromEntries(Object.entries({ ...state.content.deleted, ...data.deleted }).filter(([itemId]) => previousIds.has(itemId) || itemId in state.content!.deleted));
        const usedTags = new Set([...credentials, ...tasks].flatMap(item => item.tags.map(t => t.toLowerCase())));
        const content: SharedVaultContent = {
          vault: { name: meta.name, type: meta.type, icon: meta.icon, createdAt: state.content.vault.createdAt, updatedAt: meta.updatedAt },
          credentials,
          tasks,
          tagDefs: data.tagDefs.filter(t => usedTags.has(t.name.toLowerCase())),
          deleted
        };
        const json = JSON.stringify(content);
        if (json === state.savedJson) continue;
        if (!state.summary.role.permissions.includes('write')) {
          // Modification locale refusée par le rôle : l'interface la signale et recharge le contenu du serveur
          this.errorHandler?.(id, new SharedReadOnlyError());
          continue;
        }
        this.queueSave(id, content, json);
      }
    }
    return personal;
  }

  private queueSave(id: string, content: SharedVaultContent, json: string): void {
    const state = this.states.get(id);
    if (!state) return;
    state.content = content;
    state.pendingJson = json;
    if (state.saving) return;
    state.saving = (async () => {
      try {
        while (state.pendingJson !== null) {
          const pending = JSON.parse(state.pendingJson) as SharedVaultContent;
          state.pendingJson = null;
          await this.push(state, pending);
        }
      } catch (err) {
        this.errorHandler?.(id, err);
      } finally {
        state.saving = null;
      }
    })();
  }

  private async push(state: SharedState, content: SharedVaultContent): Promise<void> {
    if (!state.key) return;
    const key = await importVaultKey(state.key);
    let current = content;
    for (let attempt = 0; attempt < 4; attempt++) {
      const blob = await encryptVaultJson(key, JSON.stringify(current));
      try {
        const result = await this.account.withCloud(client => client.putSharedVault(state.summary.id, state.revision, blob));
        state.revision = result.revision;
        state.content = current;
        state.savedJson = JSON.stringify(current);
        return;
      } catch (err) {
        const conflict = err instanceof CloudError && err.status === 409 ? err.details as { revision: number; blob: Parameters<typeof decryptVaultData>[1] } | undefined : undefined;
        if (!conflict?.blob) throw err;
        const remote = await decryptVaultData<SharedVaultContent>(key, conflict.blob);
        const merged = mergeVaultData(asVaultData(current), asVaultData(remote));
        current = { vault: current.vault.updatedAt >= remote.vault.updatedAt ? current.vault : remote.vault, credentials: merged.credentials, tasks: merged.tasks, tagDefs: merged.tagDefs, deleted: merged.deleted };
        state.revision = conflict.revision;
        this.emit();
      }
    }
    throw new Error('Conflits répétés sur le coffre partagé, réessayez');
  }

  async flush(): Promise<void> {
    await Promise.all([...this.states.values()].map(s => s.saving));
  }

  /* ── Création, invitations, membres ────────────────────────────────── */

  async create(name: string, type: VaultMetadata['type'], icon?: VaultMetadata['icon']): Promise<string> {
    const { publicKey } = await this.account.getSharingKeys();
    const raw = randomKey();
    const content = emptyContent(name, type, icon);
    const blob = await encryptVaultJson(await importVaultKey(raw), JSON.stringify(content));
    const wrappedKey = await sealForRecipient(raw, publicKey);
    const created = await this.account.withCloud(client => client.createSharedVault(blob, wrappedKey));
    await this.refresh();
    raw.fill(0);
    return created.id;
  }

  /** Déplace un coffre personnel existant vers un nouveau coffre partagé (contenu compris) */
  async shareExisting(data: UnlockedVaultData, vaultId: string): Promise<string> {
    const vault = data.vaults.find(v => v.id === vaultId);
    if (!vault) throw new Error('Coffre introuvable');
    const { publicKey } = await this.account.getSharingKeys();
    const raw = randomKey();
    const credentials = data.credentials.filter(c => c.vaultId === vaultId);
    const tasks = data.tasks.filter(t => t.vaultId === vaultId);
    const usedTags = new Set([...credentials, ...tasks].flatMap(item => item.tags.map(t => t.toLowerCase())));
    const content: SharedVaultContent = {
      vault: { name: vault.name, type: vault.type, icon: vault.icon, createdAt: vault.createdAt, updatedAt: Date.now() },
      credentials, tasks, tagDefs: data.tagDefs.filter(t => usedTags.has(t.name.toLowerCase())), deleted: {}
    };
    const blob = await encryptVaultJson(await importVaultKey(raw), JSON.stringify(content));
    const created = await this.account.withCloud(async client => client.createSharedVault(blob, await sealForRecipient(raw, publicKey)));
    raw.fill(0);
    await this.refresh();
    return created.id;
  }

  members(vaultId: string): Promise<SharedMembers> {
    return this.account.withCloud(client => client.sharedMembers(vaultId));
  }

  async fingerprintOf(publicKeyBase64: string): Promise<string> {
    return keyFingerprint(fromBase64(publicKeyBase64));
  }

  /** Recherche le compte à inviter ; l'empreinte permet de vérifier la clé avec la personne */
  async lookup(email: string): Promise<{ userId: string; email: string; publicKey: string; fingerprint: string }> {
    const user = await this.account.withCloud(client => client.lookupUser(email));
    return { ...user, fingerprint: await this.fingerprintOf(user.publicKey) };
  }

  async invite(vaultId: string, user: { userId: string; publicKey: string }, roleId: string): Promise<void> {
    const state = this.states.get(vaultId);
    if (!state?.key) throw new Error('Coffre partagé non chargé');
    const wrappedKey = await sealForRecipient(state.key, fromBase64(user.publicKey));
    await this.account.withCloud(client => client.inviteMember(vaultId, { userId: user.userId, roleId, wrappedKey }));
  }

  async accept(vaultId: string): Promise<void> {
    await this.account.withCloud(client => client.acceptInvitation(vaultId));
    await this.refresh();
  }

  async decline(vaultId: string): Promise<void> {
    await this.account.withCloud(client => client.declineInvitation(vaultId));
    this.states.delete(vaultId);
    this.emit();
  }

  async changeRole(vaultId: string, userId: string, roleId: string): Promise<void> {
    await this.account.withCloud(client => client.changeMemberRole(vaultId, userId, roleId));
    await this.refresh();
  }

  createRole(vaultId: string, name: string, permissions: SharedPermission[]): Promise<SharedRole> {
    return this.account.withCloud(client => client.createRole(vaultId, { name, permissions }));
  }

  updateRole(vaultId: string, roleId: string, patch: { name?: string; permissions?: SharedPermission[] }): Promise<void> {
    return this.account.withCloud(client => client.updateRole(vaultId, roleId, patch));
  }

  deleteRole(vaultId: string, roleId: string): Promise<void> {
    return this.account.withCloud(client => client.deleteRole(vaultId, roleId));
  }

  private async currentUserId(): Promise<string> {
    if (!this.myUserId) {
      const email = this.account.getAccount()?.email ?? '';
      this.myUserId = (await this.account.withCloud(client => client.lookupUser(email))).userId;
    }
    return this.myUserId;
  }

  /**
   * Retire un membre et change la clé du coffre : le contenu est rechiffré et la nouvelle clé
   * n'est remise qu'aux membres restants. L'ancien membre ne peut plus lire les modifications suivantes.
   */
  async removeMember(vaultId: string, userId: string): Promise<void> {
    const state = this.states.get(vaultId);
    if (!state?.content) throw new Error('Coffre partagé non chargé');
    await this.flush();
    const { members } = await this.members(vaultId);
    const remaining = members.filter(m => m.userId !== userId && m.publicKey);
    const raw = randomKey();
    const blob = await encryptVaultJson(await importVaultKey(raw), JSON.stringify(state.content));
    const wrapped = await Promise.all(remaining.map(async m => ({ userId: m.userId, wrappedKey: await sealForRecipient(raw, fromBase64(m.publicKey!)) })));
    const result = await this.account.withCloud(client => client.rotateSharedVault(vaultId, { baseRevision: state.revision, blob, members: wrapped }));
    state.key?.fill(0);
    state.key = raw;
    state.revision = result.revision;
    await this.refresh();
  }

  async leave(vaultId: string): Promise<void> {
    const me = await this.currentUserId();
    await this.account.withCloud(client => client.removeMember(vaultId, me));
    this.states.get(vaultId)?.key?.fill(0);
    this.states.delete(vaultId);
    this.emit();
  }

  async transferOwnership(vaultId: string, userId: string, ownerRoleId: string): Promise<void> {
    await this.changeRole(vaultId, userId, ownerRoleId);
  }

  async deleteVault(vaultId: string): Promise<void> {
    await this.account.withCloud(client => client.deleteSharedVault(vaultId));
    this.states.get(vaultId)?.key?.fill(0);
    this.states.delete(vaultId);
    this.emit();
  }

  /** Au verrouillage : les clés des coffres partagés sont effacées de la mémoire */
  clear(): void {
    for (const state of this.states.values()) state.key?.fill(0);
    this.states.clear();
    this.myUserId = null;
  }
}
