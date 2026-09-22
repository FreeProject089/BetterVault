import type { UnlockedVaultData, TrashEntry } from '../types/vault';
import { mergeItem, type Versioned } from '../store/versions';

/**
 * Fusion de deux versions d'un coffre (appareil local / serveur).
 *
 * - Identifiants et tâches : fusion champ par champ à partir de leur dernier ancêtre
 *   commun (voir store/versions.ts). Une modification simultanée du même champ garde
 *   les deux valeurs au lieu d'en perdre une.
 * - Coffres, dossiers, tags, types de coffre : la version la plus récente l'emporte.
 *   Ce sont des métadonnées légères, rarement modifiées à deux endroits à la fois.
 * - Une suppression l'emporte sur toute modification antérieure à celle-ci.
 */

interface Stamped {
  id: string;
  updatedAt: number;
}

function newestWins<T extends Stamped>(primary: T[], secondary: T[], deleted: Record<string, number>): T[] {
  const byId = new Map<string, T>();
  for (const item of [...primary, ...secondary]) {
    const current = byId.get(item.id);
    if (!current || (item.updatedAt ?? 0) > (current.updatedAt ?? 0)) byId.set(item.id, item);
  }
  return keepUndeleted([...byId.values()], deleted);
}

function versioned<T extends Versioned>(primary: T[], secondary: T[], deleted: Record<string, number>): T[] {
  const byId = new Map<string, T>();
  for (const item of primary) byId.set(item.id, item);
  for (const item of secondary) {
    const current = byId.get(item.id);
    byId.set(item.id, current ? mergeItem(current, item) : item);
  }
  // L'ordre d'affichage suit le premier côté, puis les nouveautés de l'autre
  const order = [...primary.map(i => i.id), ...secondary.map(i => i.id).filter(id => !primary.some(p => p.id === id))];
  return keepUndeleted(order.map(id => byId.get(id)!), deleted);
}

const keepUndeleted = <T extends Stamped>(items: T[], deleted: Record<string, number>) =>
  items.filter(item => {
    const deletedAt = deleted[item.id];
    return deletedAt === undefined || deletedAt < (item.updatedAt ?? 0);
  });

export const TRASH_DAYS = 30;
export const MAX_TRASH = 200;

/**
 * Corbeille : la dernière entrée de chaque élément, sauf s'il a été restauré depuis
 * (il existe à nouveau), dans la limite du nombre.
 */
export function mergeTrash(a: TrashEntry[] = [], b: TrashEntry[] = [], alive: Set<string>): TrashEntry[] {
  const byId = new Map<string, TrashEntry>();
  for (const entry of [...a, ...b]) {
    const current = byId.get(entry.item.id);
    if (!current || entry.deletedAt > current.deletedAt) byId.set(entry.item.id, entry);
  }
  // Pas d'expiration ici : l'application purge elle-même, fichiers du serveur compris
  return [...byId.values()]
    .filter(entry => !alive.has(entry.item.id))
    .sort((p, q) => q.deletedAt - p.deletedAt)
    .slice(0, MAX_TRASH);
}

export function mergeVaultData(local: UnlockedVaultData, remote: UnlockedVaultData): UnlockedVaultData {
  const deleted: Record<string, number> = { ...(remote.deleted ?? {}) };
  for (const [id, deletedAt] of Object.entries(local.deleted ?? {})) {
    deleted[id] = Math.max(deleted[id] ?? 0, deletedAt);
  }

  const vaults = newestWins(local.vaults, remote.vaults, deleted);
  const activeVaultId = vaults.some(v => v.id === local.activeVaultId)
    ? local.activeVaultId
    : vaults[0]?.id ?? local.activeVaultId;

  const credentials = versioned(local.credentials, remote.credentials, deleted);
  const tasks = versioned(local.tasks, remote.tasks, deleted);
  const alive = new Set([...credentials.map(c => c.id), ...tasks.map(t => t.id)]);

  return {
    vaults,
    activeVaultId,
    credentials,
    tasks,
    tagDefs: newestWins(local.tagDefs ?? [], remote.tagDefs ?? [], deleted),
    folders: newestWins(local.folders ?? [], remote.folders ?? [], deleted),
    // Absents jusqu'ici : chaque fusion perdait les types de coffre créés par l'utilisateur
    vaultTypes: newestWins(local.vaultTypes ?? [], remote.vaultTypes ?? [], deleted),
    itemTemplates: newestWins(local.itemTemplates ?? [], remote.itemTemplates ?? [], deleted),
    trash: mergeTrash(local.trash, remote.trash, alive),
    deleted
  };
}
