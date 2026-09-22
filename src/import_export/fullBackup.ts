import { fromBase64, toBase64 } from '../account/accountCrypto';
import type { AttachmentMeta } from '../account/attachmentCrypto';
import type { CredentialItem, Task, UnlockedVaultData, VaultMetadata } from '../types/vault';

/**
 * Sauvegarde complète : tout ce qu'un compte possède, pour le rouvrir ailleurs.
 *
 * Elle sert à changer de compte ou de serveur — y compris vers un serveur tenu par
 * quelqu'un d'autre, ce que la grappe ne fait volontairement pas. C'est alors
 * l'utilisateur qui déplace ses données, pas les serveurs.
 *
 * Les fichiers joints voyagent tels qu'ils sont stockés : chiffrés, chacun avec sa
 * clé rangée dans sa fiche. L'import les renvoie sans jamais les déchiffrer ; seul
 * leur emplacement change (serveur ou coffre) selon ce que la destination accepte.
 *
 * Ce module ne touche ni au réseau ni à l'interface : l'appelant fournit de quoi
 * lire et envoyer les fichiers, ce qui le rend testable.
 */

export const FULL_BACKUP_FORMAT = 'bettervault.backup';

export interface FullBackup {
  format: typeof FULL_BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  source?: { email?: string; server?: string };
  data: UnlockedVaultData;
  /** Contenu chiffré de chaque fichier joint (base64), par identifiant de fiche */
  files: Record<string, string>;
}

export const isFullBackup = (value: unknown): value is FullBackup =>
  !!value && typeof value === 'object' && (value as FullBackup).format === FULL_BACKUP_FORMAT && (value as FullBackup).version === 1;

/* ── Export ────────────────────────────────────────────────────────────── */

export interface BackupProblem {
  vault?: string;
  file?: string;
  reason: string;
}

export async function buildFullBackup(data: UnlockedVaultData, options: {
  /** Un coffre partagé ne s'exporte que si le rôle le permet */
  canExport: (vault: VaultMetadata) => boolean;
  /** Contenu chiffré d'un fichier rangé sur le serveur */
  fetchPayload: (meta: AttachmentMeta) => Promise<Uint8Array>;
  source?: FullBackup['source'];
  onProgress?: (done: number, total: number) => void;
  now?: Date;
}): Promise<{ backup: FullBackup; problems: BackupProblem[] }> {
  const problems: BackupProblem[] = [];
  const vaults = data.vaults.filter(vault => {
    if (!vault.shared || options.canExport(vault)) return true;
    problems.push({ vault: vault.name, reason: 'export_denied' });
    return false;
  });
  const kept = new Set(vaults.map(v => v.id));
  const files: Record<string, string> = {};

  const credentials = data.credentials.filter(c => kept.has(c.vaultId));
  const total = credentials.reduce((n, c) => n + (c.attachments?.length ?? 0), 0);
  let done = 0;

  const withFiles: CredentialItem[] = [];
  for (const credential of credentials) {
    const attachments: AttachmentMeta[] = [];
    for (const meta of credential.attachments ?? []) {
      try {
        const payload = meta.data ? fromBase64(meta.data) : await options.fetchPayload(meta);
        files[meta.id] = toBase64(payload);
        const { data: _inline, ...rest } = meta;
        attachments.push(rest);
      } catch {
        problems.push({ file: meta.name, reason: 'file_unreadable' });
      }
      // Hors de l'appel : avec « ?. », l'incrément sauterait quand il n'y a pas de suivi
      done += 1;
      options.onProgress?.(done, total);
    }
    withFiles.push({ ...credential, ...(credential.attachments ? { attachments } : {}) });
  }

  return {
    backup: {
      format: FULL_BACKUP_FORMAT,
      version: 1,
      exportedAt: (options.now ?? new Date()).toISOString(),
      ...(options.source ? { source: options.source } : {}),
      data: {
        ...data,
        // Un coffre partagé sauvegardé devient un coffre ordinaire : ses membres n'existent pas ailleurs
        vaults: vaults.map(({ shared: _shared, ...vault }) => vault as VaultMetadata),
        activeVaultId: kept.has(data.activeVaultId) ? data.activeVaultId : vaults[0]?.id ?? data.activeVaultId,
        credentials: withFiles,
        tasks: data.tasks.filter(t => kept.has(t.vaultId))
      },
      files
    },
    problems
  };
}

/* ── Import : ce qui tiendra, et où ─────────────────────────────────────── */

export interface ImportTarget {
  /** Le serveur de destination garde-t-il des fichiers ? (faux pour un coffre local) */
  serverFiles: boolean;
  maxFileBytes: number;
  /** Place restante sur le serveur */
  freeBytes: number;
  /** Plus gros fichier qu'on accepte de garder dans le coffre lui-même */
  inlineMaxBytes: number;
  /** Place réservée aux fichiers gardés dans le coffre */
  inlineBudgetBytes: number;
  /** Nombre de coffres qu'on peut encore créer */
  vaultSlots: number;
}

export type FileRefusal = 'too_large' | 'no_space' | 'no_files';

export interface PlannedFile {
  metaId: string;
  name: string;
  bytes: number;
  destination: 'server' | 'vault' | 'refused';
  reason?: FileRefusal;
}

export interface ImportPlan {
  vaults: number;
  credentials: number;
  tasks: number;
  files: PlannedFile[];
  /** Place demandée sur le serveur par tous les fichiers qui y sont destinés, refusés compris */
  requiredServerBytes: number;
  availableServerBytes: number;
  /** Coffres qui ne pourront pas être créés, faute de place dans les limites du compte */
  vaultsOverLimit: number;
  /** Tout tient-il ? Sinon l'import reste possible, sans ce qui dépasse */
  complete: boolean;
}

const payloadBytes = (base64: string) => Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);

export function planImport(backup: FullBackup, target: ImportTarget): ImportPlan {
  const files: PlannedFile[] = [];
  for (const credential of backup.data.credentials) {
    for (const meta of credential.attachments ?? []) {
      const encoded = backup.files[meta.id];
      if (!encoded) continue;
      files.push({ metaId: meta.id, name: meta.name, bytes: payloadBytes(encoded), destination: 'refused' });
    }
  }

  // Les petits d'abord : quand la place manque, on en garde le plus grand nombre
  const order = [...files].sort((a, b) => a.bytes - b.bytes);
  let serverUsed = 0;
  let inlineUsed = 0;
  let requiredServerBytes = 0;
  for (const file of order) {
    if (target.serverFiles) {
      if (file.bytes > target.maxFileBytes) {
        file.reason = 'too_large';
        continue;
      }
      requiredServerBytes += file.bytes;
      if (serverUsed + file.bytes > target.freeBytes) {
        file.reason = 'no_space';
        continue;
      }
      serverUsed += file.bytes;
      file.destination = 'server';
    } else {
      // Sans stockage de fichiers, un petit fichier peut encore voyager dans le coffre chiffré
      const inlineCost = Math.ceil(file.bytes * 4 / 3);
      if (file.bytes > target.inlineMaxBytes) {
        file.reason = 'no_files';
        continue;
      }
      if (inlineUsed + inlineCost > target.inlineBudgetBytes) {
        file.reason = 'no_space';
        continue;
      }
      inlineUsed += inlineCost;
      file.destination = 'vault';
    }
  }

  const vaults = backup.data.vaults.length;
  const vaultsOverLimit = Math.max(0, vaults - Math.max(0, target.vaultSlots));
  return {
    vaults,
    credentials: backup.data.credentials.length,
    tasks: backup.data.tasks.length,
    files,
    requiredServerBytes,
    availableServerBytes: target.freeBytes,
    vaultsOverLimit,
    complete: vaultsOverLimit === 0 && files.every(f => f.destination !== 'refused')
  };
}

/* ── Import : application ──────────────────────────────────────────────── */

export interface ImportResult {
  data: UnlockedVaultData;
  imported: { vaults: number; credentials: number; tasks: number; files: number };
  skippedFiles: PlannedFile[];
  skippedVaults: string[];
}

/**
 * Ajoute la sauvegarde au coffre courant. Tout reçoit un nouvel identifiant : importer
 * deux fois ne fait pas de collision, et rien du compte de destination n'est écrasé.
 */
export async function applyImport(
  backup: FullBackup,
  plan: ImportPlan,
  current: UnlockedVaultData,
  options: {
    upload: (payload: Uint8Array) => Promise<{ id: string }>;
    /** Retire un fichier déjà envoyé quand l'import échoue ensuite : il ne doit pas occuper le quota */
    discard?: (id: string) => Promise<void>;
    newId: (prefix: string) => string;
    importedSuffix: string;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<ImportResult> {
  const { newId } = options;
  const destination = new Map(plan.files.map(f => [f.metaId, f]));
  const vaultsToImport = backup.data.vaults.slice(0, backup.data.vaults.length - plan.vaultsOverLimit);
  const skippedVaults = backup.data.vaults.slice(vaultsToImport.length).map(v => v.name);

  const vaultIds = new Map<string, string>();
  const takenNames = new Set(current.vaults.map(v => v.name.toLowerCase()));
  const vaults: VaultMetadata[] = vaultsToImport.map(vault => {
    const id = newId('vault');
    vaultIds.set(vault.id, id);
    const name = takenNames.has(vault.name.toLowerCase()) ? `${vault.name} ${options.importedSuffix}`.slice(0, 40) : vault.name;
    takenNames.add(name.toLowerCase());
    return { ...vault, id, name };
  });


  const credentialIds = new Map<string, string>();
  const credentialsSource = backup.data.credentials.filter(c => vaultIds.has(c.vaultId));
  for (const c of credentialsSource) credentialIds.set(c.id, newId('cred'));

  const total = plan.files.filter(f => f.destination !== 'refused').length;
  let done = 0;
  const skippedFiles: PlannedFile[] = plan.files.filter(f => f.destination === 'refused');
  const credentials: CredentialItem[] = [];
  const uploadedIds: string[] = [];
  try {
    for (const credential of credentialsSource) {
      const attachments: AttachmentMeta[] = [];
      for (const meta of credential.attachments ?? []) {
        const plannedFile = destination.get(meta.id);
        const encoded = backup.files[meta.id];
        if (!plannedFile || !encoded || plannedFile.destination === 'refused') continue;
        if (plannedFile.destination === 'server') {
          const uploaded = await options.upload(fromBase64(encoded));
          uploadedIds.push(uploaded.id);
          attachments.push({ ...meta, id: uploaded.id });
        } else {
          attachments.push({ ...meta, id: newId('att'), data: encoded });
        }
        // Hors de l'appel : avec « ?. », l'incrément sauterait quand il n'y a pas de suivi
        done += 1;
        options.onProgress?.(done, total);
      }
      credentials.push({
        ...credential,
        id: credentialIds.get(credential.id)!,
        vaultId: vaultIds.get(credential.vaultId)!,
          ...(credential.attachments ? { attachments } : {})
      });
    }
  } catch (err) {
    // Rien n'est gardé d'un import interrompu : on le relance sans doublon ni fichier orphelin
    if (options.discard) await Promise.allSettled(uploadedIds.map(id => options.discard!(id)));
    throw err;
  }

  const taskIds = new Map<string, string>();
  const tasksSource = backup.data.tasks.filter(t => vaultIds.has(t.vaultId));
  for (const t of tasksSource) taskIds.set(t.id, newId('task'));
  const tasks: Task[] = tasksSource.map(task => ({
    ...task,
    id: taskIds.get(task.id)!,
    vaultId: vaultIds.get(task.vaultId)!,
    ...(task.linkedCredentialId ? { linkedCredentialId: credentialIds.get(task.linkedCredentialId) } : {}),
    ...(task.dependsOn ? { dependsOn: task.dependsOn.map(id => taskIds.get(id)).filter((id): id is string => !!id) } : {})
  }));

  // Tags et types de coffre : fusion par nom, sans doublon
  const tagNames = new Set(current.tagDefs.map(t => t.name.toLowerCase()));
  const tagDefs = [...current.tagDefs, ...backup.data.tagDefs
    .filter(t => !tagNames.has(t.name.toLowerCase()))
    .map(t => ({ ...t, id: newId('tag') }))];
  const typeIds = new Map<string, string>();
  const currentTypes = current.vaultTypes ?? [];
  const vaultTypes = [...currentTypes];
  for (const type of backup.data.vaultTypes ?? []) {
    const existing = currentTypes.find(t => t.name.toLowerCase() === type.name.toLowerCase());
    if (existing) typeIds.set(type.id, existing.id);
    else {
      const id = newId('vtype');
      typeIds.set(type.id, id);
      vaultTypes.push({ ...type, id });
    }
  }
  for (const vault of vaults) if (typeIds.has(vault.type)) vault.type = typeIds.get(vault.type)!;

  // Types d'éléments personnalisés : même principe, fusion par nom
  const templateIds = new Map<string, string>();
  const currentTemplates = current.itemTemplates ?? [];
  const itemTemplates = [...currentTemplates];
  for (const template of backup.data.itemTemplates ?? []) {
    const existing = currentTemplates.find(t => t.name.toLowerCase() === template.name.toLowerCase());
    if (existing) templateIds.set(template.id, existing.id);
    else {
      const id = newId('tpl');
      templateIds.set(template.id, id);
      itemTemplates.push({ ...template, id });
    }
  }
  for (const credential of credentials) {
    if (credential.templateId) credential.templateId = templateIds.get(credential.templateId);
  }

  return {
    data: {
      ...current,
      vaults: [...current.vaults, ...vaults],
      credentials: [...credentials, ...current.credentials],
      tasks: [...tasks, ...current.tasks],
      tagDefs,
      vaultTypes,
      itemTemplates
    },
    imported: { vaults: vaults.length, credentials: credentials.length, tasks: tasks.length, files: done },
    skippedFiles,
    skippedVaults
  };
}
