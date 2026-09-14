import type { CredentialItem, Task, TagDef, UnlockedVaultData, VaultMetadata } from '../types/vault';

export const DEFAULT_VAULT_NAME = 'Personnel';
export const MAX_TAG_LENGTH = 32;
export const TAG_COLORS = ['#7773e8', '#a371f7', '#2ea043', '#d29922', '#f85149', '#db61a2', '#39c5cf', '#8b949e'];

type NewCredential = Omit<CredentialItem, 'id' | 'createdAt' | 'updatedAt'>;
type NewTask = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;

export function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
}

function createVault(name: string, type: VaultMetadata['type'], now: number): VaultMetadata {
  return { id: randomId('vault'), name, type, createdAt: now, updatedAt: now };
}

function createTagDef(name: string, colorIndex: number, now: number): TagDef {
  return { id: randomId('tag'), name, color: TAG_COLORS[colorIndex % TAG_COLORS.length], createdAt: now, updatedAt: now };
}

export function createEmptyVaultData(now = Date.now()): UnlockedVaultData {
  const vault = createVault(DEFAULT_VAULT_NAME, 'personal', now);
  return { vaults: [vault], activeVaultId: vault.id, credentials: [], tasks: [], tagDefs: [], deleted: {} };
}

/** Répare et migre des données de coffre (anciennes versions, imports, synchronisation) */
export function normalizeVaultData(input: Partial<UnlockedVaultData> | null | undefined, now = Date.now()): UnlockedVaultData {
  const source = input ?? {};
  const data: UnlockedVaultData = {
    vaults: (Array.isArray(source.vaults) ? source.vaults : []).map(v => ({
      id: v.id,
      name: v.name,
      type: v.type,
      createdAt: v.createdAt ?? now,
      updatedAt: v.updatedAt ?? now
    })),
    activeVaultId: source.activeVaultId ?? '',
    credentials: (Array.isArray(source.credentials) ? source.credentials : []).map(c => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] })),
    tasks: (Array.isArray(source.tasks) ? source.tasks : []).map(t => ({ ...t, tags: Array.isArray(t.tags) ? t.tags : [] })),
    tagDefs: Array.isArray(source.tagDefs) ? [...source.tagDefs] : [],
    deleted: source.deleted && typeof source.deleted === 'object' ? { ...source.deleted } : {}
  };

  if (data.vaults.length === 0) data.vaults.push(createVault(DEFAULT_VAULT_NAME, 'personal', now));
  if (!data.vaults.some(v => v.id === data.activeVaultId)) data.activeVaultId = data.vaults[0].id;

  const known = new Set(data.tagDefs.map(t => t.name.toLowerCase()));
  for (const raw of [...data.credentials, ...data.tasks].flatMap(item => item.tags)) {
    const name = normalizeTagName(String(raw));
    if (name && !known.has(name.toLowerCase())) {
      known.add(name.toLowerCase());
      data.tagDefs.push(createTagDef(name, data.tagDefs.length, now));
    }
  }
  return data;
}

function domainOf(website?: string): string {
  if (!website) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : 'https://' + website).hostname;
  } catch {
    return '';
  }
}

export class VaultStore {
  private data: UnlockedVaultData = createEmptyVaultData();
  private loaded = false;
  private listeners: (() => void)[] = [];
  private persist: ((data: UnlockedVaultData) => void) | null = null;

  /* ── Cycle de vie ──────────────────────────────────────────────────── */

  setPersistence(persist: ((data: UnlockedVaultData) => void) | null): void {
    this.persist = persist;
  }

  /** Charge des données déchiffrées sans déclencher d'enregistrement */
  load(data: Partial<UnlockedVaultData>): void {
    this.data = normalizeVaultData(data);
    this.loaded = true;
    this.emit();
  }

  unload(): void {
    this.data = createEmptyVaultData();
    this.loaded = false;
    this.emit();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getData(): UnlockedVaultData {
    return this.data;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(): void {
    this.listeners.forEach(l => l());
  }

  private commit(): void {
    this.persist?.(this.data);
    this.emit();
  }

  private markDeleted(id: string, now: number): void {
    this.data.deleted[id] = now;
  }

  /* ── Coffres ───────────────────────────────────────────────────────── */

  setActiveVault(vaultId: string): void {
    if (!this.data.vaults.some(v => v.id === vaultId)) return;
    this.data.activeVaultId = vaultId;
    this.emit();
  }

  addVault(name: string, type: VaultMetadata['type']): string {
    const vault = createVault(name.trim(), type, Date.now());
    this.data.vaults.push(vault);
    this.data.activeVaultId = vault.id;
    this.commit();
    return vault.id;
  }

  updateVault(vaultId: string, updates: Partial<Pick<VaultMetadata, 'name' | 'type'>>): void {
    const vault = this.data.vaults.find(v => v.id === vaultId);
    if (!vault) return;
    if (updates.name !== undefined) vault.name = updates.name.trim() || vault.name;
    if (updates.type !== undefined) vault.type = updates.type;
    vault.updatedAt = Date.now();
    this.commit();
  }

  /** Supprime un coffre et tout son contenu (le dernier coffre ne peut pas être supprimé) */
  deleteVault(vaultId: string): void {
    if (this.data.vaults.length <= 1) throw new Error('Impossible de supprimer le dernier coffre');
    const now = Date.now();
    this.data.credentials.filter(c => c.vaultId === vaultId).forEach(c => this.markDeleted(c.id, now));
    this.data.tasks.filter(t => t.vaultId === vaultId).forEach(t => this.markDeleted(t.id, now));
    this.markDeleted(vaultId, now);
    this.data.credentials = this.data.credentials.filter(c => c.vaultId !== vaultId);
    this.data.tasks = this.data.tasks.filter(t => t.vaultId !== vaultId);
    this.data.vaults = this.data.vaults.filter(v => v.id !== vaultId);
    if (this.data.activeVaultId === vaultId) this.data.activeVaultId = this.data.vaults[0].id;
    this.commit();
  }

  /* ── Identifiants ──────────────────────────────────────────────────── */

  addCredential(item: NewCredential): string {
    const now = Date.now();
    const credential: CredentialItem = { ...item, tags: this.ensureTags(item.tags), id: randomId('cred'), createdAt: now, updatedAt: now };
    this.data.credentials.unshift(credential);
    this.commit();
    return credential.id;
  }

  updateCredential(id: string, updates: Partial<CredentialItem>): void {
    const index = this.data.credentials.findIndex(c => c.id === id);
    if (index === -1) return;
    const current = this.data.credentials[index];
    let history = current.passwordHistory || [];

    if (updates.password !== undefined && updates.password !== current.password) {
      history = [{ password: current.password, changedAt: Date.now() }, ...history.slice(0, 9)];
    }

    this.data.credentials[index] = {
      ...current,
      ...updates,
      tags: updates.tags ? this.ensureTags(updates.tags) : current.tags,
      passwordHistory: history,
      updatedAt: Date.now()
    };
    this.commit();
  }

  deleteCredential(id: string): void {
    const now = Date.now();
    this.data.credentials = this.data.credentials.filter(c => c.id !== id);
    this.data.tasks = this.data.tasks.map(t => t.linkedCredentialId === id ? { ...t, linkedCredentialId: undefined, updatedAt: now } : t);
    this.markDeleted(id, now);
    this.commit();
  }

  /* ── Tâches ────────────────────────────────────────────────────────── */

  addTask(task: NewTask): string {
    const now = Date.now();
    const created: Task = { ...task, tags: this.ensureTags(task.tags), id: randomId('task'), createdAt: now, updatedAt: now };
    this.data.tasks.unshift(created);
    this.commit();
    return created.id;
  }

  updateTask(id: string, updates: Partial<Task>): void {
    const index = this.data.tasks.findIndex(t => t.id === id);
    if (index === -1) return;
    const current = this.data.tasks[index];
    this.data.tasks[index] = {
      ...current,
      ...updates,
      tags: updates.tags ? this.ensureTags(updates.tags) : current.tags,
      updatedAt: Date.now()
    };
    this.commit();
  }

  deleteTask(id: string): void {
    const now = Date.now();
    this.data.tasks = this.data.tasks
      .filter(t => t.id !== id)
      .map(t => t.dependsOn?.includes(id) ? { ...t, dependsOn: t.dependsOn.filter(d => d !== id), updatedAt: now } : t);
    this.markDeleted(id, now);
    this.commit();
  }

  /* ── Tags ──────────────────────────────────────────────────────────── */

  getTags(): TagDef[] {
    return [...this.data.tagDefs].sort((a, b) => a.name.localeCompare(b.name));
  }

  getTagByName(name: string): TagDef | undefined {
    const key = normalizeTagName(name).toLowerCase();
    return this.data.tagDefs.find(t => t.name.toLowerCase() === key);
  }

  countTagUsage(name: string): number {
    const key = name.toLowerCase();
    return [...this.data.credentials, ...this.data.tasks].filter(item => item.tags.some(t => t.toLowerCase() === key)).length;
  }

  createTag(name: string, color?: string): TagDef {
    const normalized = normalizeTagName(name);
    if (!normalized) throw new Error('Le nom du tag est vide');
    const existing = this.getTagByName(normalized);
    if (existing) return existing;
    const now = Date.now();
    const tag = createTagDef(normalized, this.data.tagDefs.length, now);
    if (color) tag.color = color;
    this.data.tagDefs.push(tag);
    this.commit();
    return tag;
  }

  updateTag(tagId: string, updates: { name?: string; color?: string }): void {
    const tag = this.data.tagDefs.find(t => t.id === tagId);
    if (!tag) return;
    const now = Date.now();

    if (updates.name !== undefined) {
      const name = normalizeTagName(updates.name);
      if (!name) throw new Error('Le nom du tag est vide');
      const clash = this.data.tagDefs.find(t => t.id !== tagId && t.name.toLowerCase() === name.toLowerCase());
      if (clash) throw new Error(`Le tag « ${clash.name} » existe déjà`);

      const oldKey = tag.name.toLowerCase();
      const rename = <T extends { tags: string[]; updatedAt: number }>(item: T): T =>
        item.tags.some(t => t.toLowerCase() === oldKey)
          ? { ...item, tags: item.tags.map(t => t.toLowerCase() === oldKey ? name : t), updatedAt: now }
          : item;
      this.data.credentials = this.data.credentials.map(rename);
      this.data.tasks = this.data.tasks.map(rename);
      tag.name = name;
    }
    if (updates.color !== undefined) tag.color = updates.color;
    tag.updatedAt = now;
    this.commit();
  }

  deleteTag(tagId: string): void {
    const tag = this.data.tagDefs.find(t => t.id === tagId);
    if (!tag) return;
    const now = Date.now();
    const key = tag.name.toLowerCase();
    const strip = <T extends { tags: string[]; updatedAt: number }>(item: T): T =>
      item.tags.some(t => t.toLowerCase() === key)
        ? { ...item, tags: item.tags.filter(t => t.toLowerCase() !== key), updatedAt: now }
        : item;
    this.data.credentials = this.data.credentials.map(strip);
    this.data.tasks = this.data.tasks.map(strip);
    this.data.tagDefs = this.data.tagDefs.filter(t => t.id !== tagId);
    this.markDeleted(tagId, now);
    this.commit();
  }

  /** Normalise une liste de tags et crée les définitions manquantes (sans enregistrer) */
  private ensureTags(names: string[]): string[] {
    const result: string[] = [];
    const now = Date.now();
    for (const raw of names) {
      const name = normalizeTagName(raw);
      if (!name) continue;
      const existing = this.getTagByName(name);
      const canonical = existing?.name ?? name;
      if (!existing) this.data.tagDefs.push(createTagDef(name, this.data.tagDefs.length, now));
      if (!result.some(t => t.toLowerCase() === canonical.toLowerCase())) result.push(canonical);
    }
    return result;
  }

  /* ── Import ────────────────────────────────────────────────────────── */

  importBulk(credentials: Partial<CredentialItem>[], tasks: Partial<Task>[]): { credentials: number; tasks: number } {
    const vaultId = this.data.activeVaultId;
    const now = Date.now();

    const newCredentials: CredentialItem[] = credentials.map(c => ({
      id: randomId('cred'),
      vaultId,
      title: c.title || 'Sans titre',
      username: c.username || '',
      password: c.password || '',
      website: c.website || '',
      domain: domainOf(c.website),
      totpSecret: c.totpSecret || undefined,
      passkeys: c.passkeys,
      fields: c.fields,
      isFavorite: c.isFavorite,
      expiresAt: c.expiresAt,
      notes: c.notes || '',
      tags: this.ensureTags(c.tags ?? []),
      createdAt: c.createdAt ?? now,
      updatedAt: now
    }));

    const newTasks: Task[] = tasks.map(t => ({
      id: randomId('task'),
      vaultId,
      title: t.title || 'Sans titre',
      description: t.description,
      status: t.status || 'todo',
      priority: t.priority || 'medium',
      dueDate: t.dueDate,
      subtasks: t.subtasks,
      notes: t.notes,
      tags: this.ensureTags(t.tags ?? []),
      createdAt: t.createdAt ?? now,
      updatedAt: now
    }));

    this.data.credentials = [...newCredentials, ...this.data.credentials];
    this.data.tasks = [...newTasks, ...this.data.tasks];
    this.commit();
    return { credentials: newCredentials.length, tasks: newTasks.length };
  }
}

export const vaultStore = new VaultStore();
