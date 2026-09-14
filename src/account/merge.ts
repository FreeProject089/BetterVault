import type { UnlockedVaultData } from '../types/vault';

/**
 * Fusion de deux versions d'un coffre (appareil local / serveur).
 * Chaque élément garde sa version la plus récente (updatedAt) ; une suppression
 * l'emporte sur toute modification antérieure à celle-ci.
 */

interface Versioned {
  id: string;
  updatedAt: number;
}

function mergeCollection<T extends Versioned>(primary: T[], secondary: T[], deleted: Record<string, number>): T[] {
  const byId = new Map<string, T>();
  for (const item of [...primary, ...secondary]) {
    const current = byId.get(item.id);
    if (!current || (item.updatedAt ?? 0) > (current.updatedAt ?? 0)) byId.set(item.id, item);
  }
  return [...byId.values()].filter(item => {
    const deletedAt = deleted[item.id];
    return deletedAt === undefined || deletedAt < (item.updatedAt ?? 0);
  });
}

export function mergeVaultData(local: UnlockedVaultData, remote: UnlockedVaultData): UnlockedVaultData {
  const deleted: Record<string, number> = { ...(remote.deleted ?? {}) };
  for (const [id, deletedAt] of Object.entries(local.deleted ?? {})) {
    deleted[id] = Math.max(deleted[id] ?? 0, deletedAt);
  }

  const vaults = mergeCollection(local.vaults, remote.vaults, deleted);
  const activeVaultId = vaults.some(v => v.id === local.activeVaultId)
    ? local.activeVaultId
    : vaults[0]?.id ?? local.activeVaultId;

  return {
    vaults,
    activeVaultId,
    credentials: mergeCollection(local.credentials, remote.credentials, deleted),
    tasks: mergeCollection(local.tasks, remote.tasks, deleted),
    tagDefs: mergeCollection(local.tagDefs ?? [], remote.tagDefs ?? [], deleted),
    deleted
  };
}
