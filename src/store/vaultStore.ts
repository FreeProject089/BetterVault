import type { CredentialItem, FolderDef, Task, TagDef, UnlockedVaultData, VaultMetadata, VaultTypeDef } from '../types/vault';
import { cardBrand, EMPTY_CARD, EMPTY_IDENTITY, EMPTY_SSH_KEY, itemTypeOf, type CardData, type IdentityData, type ItemType, type SshKeyData } from '../types/itemTypes';
import { normalizeItemIcon, type ItemIcon } from '../icons/iconLibrary';
import { normalizeAttachments } from '../account/attachmentCrypto';

export const DEFAULT_VAULT_NAME = 'Personnel';
export const MAX_TAG_LENGTH = 32;
export const TAG_COLORS = ['#7773e8', '#a371f7', '#2ea043', '#d29922', '#f85149', '#db61a2', '#39c5cf', '#8b949e'];

type NewCredential = Omit<CredentialItem, 'id' | 'createdAt' | 'updatedAt'>;
type NewTask = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Forme imposée à tout identifiant présent dans le coffre.
 *
 * Les identifiants finissent dans des attributs HTML et des sélecteurs CSS. Ceux
 * que l'application produit sont sûrs, mais un coffre partagé, un import ou un
 * autre appareil peuvent en apporter d'arbitraires : on les remplace à l'entrée
 * plutôt que d'espérer que chacun des points d'affichage pense à les échapper.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

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
  return { vaults: [vault], activeVaultId: vault.id, credentials: [], tasks: [], tagDefs: [], folders: [], vaultTypes: [], deleted: {} };
}

export const MAX_FOLDER_NAME_LENGTH = 60;
/** Profondeur maximale de l'arborescence, pour garder la barre latérale lisible */
export const MAX_FOLDER_DEPTH = 5;

export function normalizeFolderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_FOLDER_NAME_LENGTH);
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Ne garde que les champs connus du type, en texte : le reste d'un import n'entre pas dans le coffre */
function normalizeCard(input: unknown): CardData | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Partial<Record<keyof CardData, unknown>>;
  const card: CardData = {
    number: textOf(raw.number),
    holder: textOf(raw.holder),
    expMonth: textOf(raw.expMonth),
    expYear: textOf(raw.expYear),
    cvv: textOf(raw.cvv),
    pin: textOf(raw.pin)
  };
  const brand = cardBrand(card.number);
  if (brand) card.brand = brand;
  return card;
}

function normalizeIdentity(input: unknown): IdentityData | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const identity = { ...EMPTY_IDENTITY };
  for (const key of Object.keys(EMPTY_IDENTITY) as (keyof IdentityData)[]) identity[key] = textOf(raw[key]);
  return identity;
}

function normalizeSshKey(input: unknown): SshKeyData | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const key: SshKeyData = {
    privateKey: textOf(raw.privateKey),
    publicKey: textOf(raw.publicKey),
    passphrase: textOf(raw.passphrase)
  };
  const fingerprint = textOf(raw.fingerprint);
  if (fingerprint) key.fingerprint = fingerprint;
  return key;
}

/** Les champs d'un type ne sont gardés que pour ce type : changer de type ne traîne pas d'anciennes données */
export function payloadForType(type: ItemType, source: Partial<CredentialItem>): Pick<CredentialItem, 'card' | 'identity' | 'sshKey'> {
  if (type === 'card') return { card: normalizeCard(source.card) ?? { ...EMPTY_CARD } };
  if (type === 'identity') return { identity: normalizeIdentity(source.identity) ?? { ...EMPTY_IDENTITY } };
  if (type === 'sshKey') return { sshKey: normalizeSshKey(source.sshKey) ?? { ...EMPTY_SSH_KEY } };
  return {};
}

/** Répare et migre des données de coffre (anciennes versions, imports, synchronisation) */
export function normalizeVaultData(input: Partial<UnlockedVaultData> | null | undefined, now = Date.now()): UnlockedVaultData {
  const source = input ?? {};
  const data: UnlockedVaultData = {
    vaults: (Array.isArray(source.vaults) ? source.vaults : []).map(v => ({
      id: v.id,
      name: v.name,
      type: v.type,
      ...(normalizeItemIcon(v.icon) ? { icon: normalizeItemIcon(v.icon) } : {}),
      ...(v.shared ? { shared: v.shared } : {}),
      createdAt: v.createdAt ?? now,
      updatedAt: v.updatedAt ?? now
    })),
    activeVaultId: source.activeVaultId ?? '',
    // Les icônes viennent aussi d'imports et d'autres appareils : leur SVG est toujours re-nettoyé
    credentials: (Array.isArray(source.credentials) ? source.credentials : []).map(c => {
      const { icon, attachments, card, identity, sshKey, type, ...rest } = c;
      const clean = normalizeItemIcon(icon);
      const files = normalizeAttachments(attachments);
      const itemType = itemTypeOf(type);
      return {
        ...rest,
        type: itemType,
        ...payloadForType(itemType, { card, identity, sshKey }),
        ...(clean ? { icon: clean } : {}),
        ...(files ? { attachments: files } : {}),
        tags: Array.isArray(c.tags) ? c.tags : []
      };
    }),
    tasks: (Array.isArray(source.tasks) ? source.tasks : []).map(t => ({ ...t, tags: Array.isArray(t.tags) ? t.tags : [] })),
    tagDefs: (Array.isArray(source.tagDefs) ? source.tagDefs : []).map(({ icon, ...tag }) => {
      const clean = normalizeItemIcon(icon);
      return { ...tag, ...(clean ? { icon: clean } : {}) };
    }),
    folders: (Array.isArray(source.folders) ? source.folders : [])
      .filter(f => f && typeof f.id === 'string' && typeof f.vaultId === 'string')
      .map(({ icon, ...folder }) => {
        const clean = normalizeItemIcon(icon);
        return {
          ...folder,
          name: normalizeFolderName(String(folder.name ?? '')) || 'Dossier',
          ...(clean ? { icon: clean } : {}),
          ...(typeof folder.parentId === 'string' ? { parentId: folder.parentId } : {}),
          createdAt: folder.createdAt ?? now,
          updatedAt: folder.updatedAt ?? now
        };
      }),
    vaultTypes: (Array.isArray(source.vaultTypes) ? source.vaultTypes : [])
      .filter(type => type && typeof type.id === 'string' && typeof type.name === 'string')
      .map(type => ({ id: type.id, name: String(type.name).trim().slice(0, 40), createdAt: type.createdAt ?? now, updatedAt: type.updatedAt ?? now })),
    deleted: source.deleted && typeof source.deleted === 'object' ? { ...source.deleted } : {}
  };

  if (data.vaults.length === 0) data.vaults.push(createVault(DEFAULT_VAULT_NAME, 'personal', now));
  if (!data.vaults.some(v => v.id === data.activeVaultId)) data.activeVaultId = data.vaults[0].id;

  // Les identifiants qui ne respectent pas la forme attendue sont remplacés, et
  // toutes les références qui les désignaient suivent : rien n'est perdu.
  const remap = new Map<string, string>();
  const safe = (value: unknown, prefix: string): string => {
    if (isSafeId(value)) return value;
    const previous = typeof value === 'string' ? value : '';
    const existing = remap.get(previous);
    if (existing) return existing;
    const replacement = randomId(prefix);
    remap.set(previous, replacement);
    return replacement;
  };

  for (const vault of data.vaults) vault.id = safe(vault.id, 'vault');
  for (const folder of data.folders) folder.id = safe(folder.id, 'folder');
  for (const tag of data.tagDefs) tag.id = safe(tag.id, 'tag');
  for (const type of data.vaultTypes ?? []) type.id = safe(type.id, 'type');
  for (const credential of data.credentials) {
    credential.id = safe(credential.id, 'cred');
    for (const field of credential.fields ?? []) field.id = safe(field.id, 'field');
  }
  for (const task of data.tasks) {
    task.id = safe(task.id, 'task');
    for (const sub of task.subtasks ?? []) sub.id = safe(sub.id, 'sub');
  }

  if (remap.size) {
    const follow = (value: string | undefined): string | undefined =>
      value === undefined ? undefined : (remap.get(value) ?? value);

    data.activeVaultId = follow(data.activeVaultId) ?? data.activeVaultId;
    for (const folder of data.folders) {
      folder.vaultId = follow(folder.vaultId) ?? folder.vaultId;
      if (folder.parentId) folder.parentId = follow(folder.parentId);
    }
    for (const credential of data.credentials) {
      credential.vaultId = follow(credential.vaultId) ?? credential.vaultId;
      if (credential.folderId) credential.folderId = follow(credential.folderId);
    }
    for (const task of data.tasks) {
      task.vaultId = follow(task.vaultId) ?? task.vaultId;
      if (task.linkedCredentialId) task.linkedCredentialId = follow(task.linkedCredentialId);
      if (task.dependsOn) task.dependsOn = task.dependsOn.map(id => follow(id) ?? id);
    }
    for (const vault of data.vaults) {
      if (vault.type) vault.type = follow(vault.type) ?? vault.type;
    }
    data.deleted = Object.fromEntries(Object.entries(data.deleted).map(([id, at]) => [follow(id) ?? id, at]));
  }

  // Un dossier dont le parent a disparu (suppression sur un autre appareil) remonte à la racine,
  // et une boucle de parents rendrait l'arborescence infinie : les deux cas sont réparés ici.
  const folderIds = new Set(data.folders.map(f => f.id));
  const byId = new Map(data.folders.map(f => [f.id, f]));
  for (const folder of data.folders) {
    if (folder.parentId && !folderIds.has(folder.parentId)) delete folder.parentId;
  }
  /*
   * Détection de boucles en un seul passage.
   *
   * Remonter la chaîne des parents depuis CHAQUE dossier coûte le produit du nombre
   * de dossiers par la profondeur : un coffre partagé contenant une longue chaîne
   * suffisait alors à figer l'onglet au chargement. Ici chaque dossier est visité
   * une fois : « en cours » marque la branche courante, « sûr » ce qui a déjà été
   * jugé. Retomber sur un dossier « en cours » ferme une boucle, qu'on coupe.
   */
  const etat = new Map<string, 'en-cours' | 'sur'>();
  for (const depart of data.folders) {
    if (etat.has(depart.id)) continue;
    const branche: FolderDef[] = [];
    let courant: FolderDef | undefined = depart;
    while (courant && !etat.has(courant.id)) {
      etat.set(courant.id, 'en-cours');
      branche.push(courant);
      courant = courant.parentId ? byId.get(courant.parentId) : undefined;
    }
    // On s'est arrêté sur la racine, sur une branche déjà sûre, ou sur une boucle
    if (courant && etat.get(courant.id) === 'en-cours') delete branche[branche.length - 1].parentId;
    for (const visite of branche) etat.set(visite.id, 'sur');
  }
  for (const credential of data.credentials) {
    if (credential.folderId && !folderIds.has(credential.folderId)) delete credential.folderId;
  }

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

  addVault(name: string, type: VaultMetadata['type'], icon?: VaultMetadata['icon']): string {
    const vault = createVault(name.trim(), type, Date.now());
    const cleanIcon = normalizeItemIcon(icon);
    if (cleanIcon) vault.icon = cleanIcon;
    this.data.vaults.push(vault);
    this.data.activeVaultId = vault.id;
    this.commit();
    return vault.id;
  }

  updateVault(vaultId: string, updates: Partial<Pick<VaultMetadata, 'name' | 'type' | 'icon'>>): void {
    const vault = this.data.vaults.find(v => v.id === vaultId);
    if (!vault) return;
    if (updates.name !== undefined) vault.name = updates.name.trim() || vault.name;
    if (updates.type !== undefined) vault.type = updates.type;
    if ('icon' in updates) {
      const icon = normalizeItemIcon(updates.icon);
      if (icon) vault.icon = icon;
      else delete vault.icon;
    }
    vault.updatedAt = Date.now();
    this.commit();
  }

  /* ── Types de coffres ─────────────────────────────────────────────── */

  getVaultTypes(): VaultTypeDef[] {
    return [...(this.data.vaultTypes ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Crée un type de coffre, ou renvoie celui qui porte déjà ce nom */
  createVaultType(name: string, max: number): VaultTypeDef {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!clean) throw new Error('Le nom du type est vide');
    const types = this.data.vaultTypes ?? (this.data.vaultTypes = []);
    const existing = types.find(t => t.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    if (types.length >= max) throw new Error(`Limite de ${max} types de coffres atteinte`);
    const now = Date.now();
    const type: VaultTypeDef = { id: randomId('vtype'), name: clean, createdAt: now, updatedAt: now };
    types.push(type);
    this.commit();
    return type;
  }

  /** Supprime un type ; les coffres qui l'utilisaient repassent en « Personnel » */
  deleteVaultType(typeId: string): void {
    const types = this.data.vaultTypes ?? [];
    if (!types.some(t => t.id === typeId)) return;
    const now = Date.now();
    this.data.vaults.forEach(vault => {
      if (vault.type !== typeId) return;
      vault.type = 'personal';
      vault.updatedAt = now;
    });
    this.data.vaultTypes = types.filter(t => t.id !== typeId);
    this.markDeleted(typeId, now);
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

  /**
   * Retire un coffre et son contenu de la copie personnelle sans marque de suppression :
   * utilisé quand le coffre est déplacé vers un coffre partagé (ses éléments continuent d'exister ailleurs).
   */
  removeVaultSilently(vaultId: string): void {
    if (this.data.vaults.length <= 1) throw new Error('Gardez au moins un coffre personnel');
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

  /* ── Effacement choisi ─────────────────────────────────────────────── */

  /**
   * Efface d'un coup les catégories demandées, dans les coffres indiqués.
   *
   * Chaque identifiant retiré est inscrit dans « deleted » : sans cela l'autre
   * appareil, qui possède encore l'élément, le renverrait à la synchronisation
   * suivante et l'effacement serait défait sans que personne ne comprenne pourquoi.
   */
  eraseData(choix: {
    vaultIds: string[];
    credentials?: boolean;
    tasks?: boolean;
    folders?: boolean;
    tags?: boolean;
  }): { credentials: number; tasks: number; folders: number; tags: number } {
    const now = Date.now();
    const cible = new Set(choix.vaultIds);
    const bilan = { credentials: 0, tasks: 0, folders: 0, tags: 0 };

    if (choix.credentials) {
      const partants = this.data.credentials.filter(c => cible.has(c.vaultId));
      bilan.credentials = partants.length;
      for (const c of partants) this.markDeleted(c.id, now);
      const partis = new Set(partants.map(c => c.id));
      this.data.credentials = this.data.credentials.filter(c => !partis.has(c.id));
      // Une tâche qui pointait vers un identifiant effacé perd son lien, pas son existence
      this.data.tasks = this.data.tasks.map(t =>
        t.linkedCredentialId && partis.has(t.linkedCredentialId) ? { ...t, linkedCredentialId: undefined, updatedAt: now } : t);
    }

    if (choix.tasks) {
      const partants = this.data.tasks.filter(t => cible.has(t.vaultId));
      bilan.tasks = partants.length;
      for (const t of partants) this.markDeleted(t.id, now);
      const partis = new Set(partants.map(t => t.id));
      this.data.tasks = this.data.tasks.filter(t => !partis.has(t.id));
      // Une dépendance vers une tâche effacée ne mène nulle part : on la retire
      this.data.tasks = this.data.tasks.map(t => t.dependsOn?.some(id => partis.has(id))
        ? { ...t, dependsOn: t.dependsOn.filter(id => !partis.has(id)), updatedAt: now }
        : t);
    }

    if (choix.folders) {
      const partants = this.data.folders.filter(f => cible.has(f.vaultId));
      bilan.folders = partants.length;
      const partis = new Set(partants.map(f => f.id));
      this.data.folders = this.data.folders.filter(f => !partis.has(f.id));
      // Ce qui reste et pointait vers un dossier effacé remonte à la racine
      this.data.credentials = this.data.credentials.map(c =>
        c.folderId && partis.has(c.folderId) ? { ...c, folderId: undefined, updatedAt: now } : c);
    }

    if (choix.tags) {
      // Un tag n'appartient à aucun coffre : on ne retire que ceux qui ne servent plus
      const encoreUtilises = new Set([...this.data.credentials, ...this.data.tasks]
        .flatMap(item => item.tags.map(t => t.toLowerCase())));
      const partants = this.data.tagDefs.filter(t => !encoreUtilises.has(t.name.toLowerCase()));
      bilan.tags = partants.length;
      const partis = new Set(partants.map(t => t.id));
      this.data.tagDefs = this.data.tagDefs.filter(t => !partis.has(t.id));
    }

    this.commit();
    return bilan;
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

  updateTag(tagId: string, updates: { name?: string; color?: string; icon?: ItemIcon | null }): void {
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
    if (updates.icon !== undefined) {
      if (updates.icon) tag.icon = updates.icon;
      else delete tag.icon;
    }
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

  /* ── Dossiers ──────────────────────────────────────────────────────── */

  /** Dossiers d'un coffre, triés par nom ; sans argument, ceux du coffre actif */
  getFolders(vaultId = this.data.activeVaultId): FolderDef[] {
    return this.data.folders
      .filter(f => f.vaultId === vaultId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getFolder(folderId: string): FolderDef | undefined {
    return this.data.folders.find(f => f.id === folderId);
  }

  /** Chemin depuis la racine jusqu'au dossier, dossier compris */
  folderPath(folderId: string): FolderDef[] {
    const path: FolderDef[] = [];
    const seen = new Set<string>();
    let current = this.getFolder(folderId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current);
      current = current.parentId ? this.getFolder(current.parentId) : undefined;
    }
    return path;
  }

  /** Identifiants du dossier et de tous ses sous-dossiers */
  folderSubtree(folderId: string): string[] {
    const result = [folderId];
    for (let i = 0; i < result.length; i++) {
      for (const folder of this.data.folders) {
        if (folder.parentId === result[i] && !result.includes(folder.id)) result.push(folder.id);
      }
    }
    return result;
  }

  countFolderItems(folderId: string, includeSubfolders = true): number {
    const ids = new Set(includeSubfolders ? this.folderSubtree(folderId) : [folderId]);
    return this.data.credentials.filter(c => c.folderId && ids.has(c.folderId)).length;
  }

  createFolder(name: string, options: { parentId?: string; vaultId?: string; icon?: ItemIcon } = {}): FolderDef {
    const normalized = normalizeFolderName(name);
    if (!normalized) throw new Error('Le nom du dossier est vide');
    const vaultId = options.vaultId ?? this.data.activeVaultId;
    if (options.parentId) {
      const parent = this.getFolder(options.parentId);
      if (!parent || parent.vaultId !== vaultId) throw new Error('Dossier parent introuvable');
      if (this.folderPath(options.parentId).length >= MAX_FOLDER_DEPTH) {
        throw new Error(`Les dossiers ne peuvent pas s'imbriquer plus de ${MAX_FOLDER_DEPTH} fois`);
      }
    }
    const now = Date.now();
    const folder: FolderDef = {
      id: randomId('folder'),
      vaultId,
      name: normalized,
      ...(options.parentId ? { parentId: options.parentId } : {}),
      ...(options.icon ? { icon: options.icon } : {}),
      createdAt: now,
      updatedAt: now
    };
    this.data.folders.push(folder);
    this.commit();
    return folder;
  }

  updateFolder(folderId: string, updates: { name?: string; icon?: ItemIcon | null; parentId?: string | null }): void {
    const folder = this.getFolder(folderId);
    if (!folder) return;
    const now = Date.now();

    if (updates.name !== undefined) {
      const name = normalizeFolderName(updates.name);
      if (!name) throw new Error('Le nom du dossier est vide');
      folder.name = name;
    }
    if (updates.parentId !== undefined) {
      if (updates.parentId === null) {
        delete folder.parentId;
      } else {
        // Déplacer un dossier dans sa propre descendance le détacherait de l'arborescence
        if (this.folderSubtree(folderId).includes(updates.parentId)) {
          throw new Error('Un dossier ne peut pas être déplacé dans lui-même');
        }
        const parent = this.getFolder(updates.parentId);
        if (!parent || parent.vaultId !== folder.vaultId) throw new Error('Dossier parent introuvable');
        folder.parentId = updates.parentId;
      }
    }
    if (updates.icon !== undefined) {
      if (updates.icon) folder.icon = updates.icon;
      else delete folder.icon;
    }
    folder.updatedAt = now;
    this.commit();
  }

  /**
   * Supprime un dossier. Son contenu n'est jamais supprimé : les éléments et les
   * sous-dossiers remontent au parent du dossier retiré.
   */
  deleteFolder(folderId: string): void {
    const folder = this.getFolder(folderId);
    if (!folder) return;
    const now = Date.now();
    const parentId = folder.parentId;

    this.data.folders = this.data.folders.filter(f => f.id !== folderId).map(f =>
      f.parentId === folderId
        ? { ...f, ...(parentId ? { parentId } : { parentId: undefined }), updatedAt: now }
        : f);
    this.data.credentials = this.data.credentials.map(c =>
      c.folderId === folderId
        ? { ...c, ...(parentId ? { folderId: parentId } : { folderId: undefined }), updatedAt: now }
        : c);
    this.markDeleted(folderId, now);
    this.commit();
  }

  /** Range un élément dans un dossier, ou à la racine avec null */
  moveToFolder(credentialId: string, folderId: string | null): void {
    const credential = this.data.credentials.find(c => c.id === credentialId);
    if (!credential) return;
    if (folderId && !this.getFolder(folderId)) throw new Error('Dossier introuvable');
    if (folderId) credential.folderId = folderId;
    else delete credential.folderId;
    credential.updatedAt = Date.now();
    this.commit();
  }

  /* ── Import ────────────────────────────────────────────────────────── */

  importBulk(credentials: Partial<CredentialItem>[], tasks: Partial<Task>[]): { credentials: number; tasks: number } {
    const vaultId = this.data.activeVaultId;
    const now = Date.now();

    const newCredentials: CredentialItem[] = credentials.map(c => ({
      id: randomId('cred'),
      vaultId,
      // Un export BetterVault rapporte le type et ses champs ; un import d'ailleurs donne un identifiant
      type: itemTypeOf(c.type),
      ...payloadForType(itemTypeOf(c.type), c),
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
