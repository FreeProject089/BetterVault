import type { CredentialItem, Task, UnlockedVaultData } from '../types/vault';

/**
 * Limites d'un coffre. Les données étant chiffrées avant l'envoi, c'est l'application qui les applique :
 * celles d'un compte synchronisé viennent du serveur (.env ou page d'administration), les autres sont les valeurs par défaut.
 */
export interface VaultLimits {
  maxVaults: number;
  maxVaultTypes: number;
  maxCredentialsPerVault: number;
  maxTasksPerVault: number;
  maxTitleLength: number;
  maxUsernameLength: number;
  maxPasswordLength: number;
  maxUrlLength: number;
  maxNoteLength: number;
  maxCustomFields: number;
  maxTagsPerItem: number;
  maxVaultBytes: number;
  maxAttachmentBytes: number;
  attachmentQuotaBytes: number;
}

export const DEFAULT_VAULT_LIMITS: VaultLimits = {
  maxVaults: 20,
  maxVaultTypes: 20,
  maxCredentialsPerVault: 5000,
  maxTasksPerVault: 5000,
  maxTitleLength: 200,
  maxUsernameLength: 500,
  maxPasswordLength: 1000,
  maxUrlLength: 2048,
  maxNoteLength: 20000,
  maxCustomFields: 50,
  maxTagsPerItem: 20,
  maxVaultBytes: 20 * 1024 * 1024,
  maxAttachmentBytes: 25 * 1024 * 1024,
  attachmentQuotaBytes: 500 * 1024 * 1024
};

type Tr = (fr: string, en: string) => string;
const defaultTr: Tr = fr => fr;

export function sanitizeLimits(input: Partial<VaultLimits> | null | undefined): VaultLimits {
  const limits = { ...DEFAULT_VAULT_LIMITS };
  for (const key of Object.keys(limits) as Array<keyof VaultLimits>) {
    const value = input?.[key];
    if (Number.isInteger(value) && (value as number) > 0) limits[key] = value as number;
  }
  return limits;
}

const tooLong = (tr: Tr, fr: string, en: string, max: number) =>
  tr(`${fr} : ${max.toLocaleString('fr-FR')} caractères maximum`, `${en}: ${max.toLocaleString('en-US')} characters maximum`);

/** Vérifie un identifiant avant enregistrement ; retourne le premier problème ou null */
export function checkCredential(item: Partial<CredentialItem>, limits: VaultLimits, tr: Tr = defaultTr): string | null {
  if ((item.title ?? '').length > limits.maxTitleLength) return tooLong(tr, 'Nom', 'Name', limits.maxTitleLength);
  if ((item.username ?? '').length > limits.maxUsernameLength) return tooLong(tr, 'Identifiant', 'Username', limits.maxUsernameLength);
  if ((item.password ?? '').length > limits.maxPasswordLength) return tooLong(tr, 'Mot de passe', 'Password', limits.maxPasswordLength);
  if ((item.website ?? '').length > limits.maxUrlLength) return tooLong(tr, 'Adresse du site', 'Website', limits.maxUrlLength);
  if ((item.notes ?? '').length > limits.maxNoteLength) return tooLong(tr, 'Notes', 'Notes', limits.maxNoteLength);
  if ((item.fields ?? []).length > limits.maxCustomFields) {
    return tr(`${limits.maxCustomFields} champs personnalisés maximum`, `${limits.maxCustomFields} custom fields maximum`);
  }
  if ((item.fields ?? []).some(f => f.value.length > limits.maxNoteLength || f.label.length > limits.maxTitleLength)) {
    return tooLong(tr, 'Champ personnalisé', 'Custom field', limits.maxNoteLength);
  }
  if ((item.tags ?? []).length > limits.maxTagsPerItem) return tr(`${limits.maxTagsPerItem} tags maximum`, `${limits.maxTagsPerItem} tags maximum`);
  return null;
}

export function checkTask(item: Partial<Task>, limits: VaultLimits, tr: Tr = defaultTr): string | null {
  if ((item.title ?? '').length > limits.maxTitleLength) return tooLong(tr, 'Titre', 'Title', limits.maxTitleLength);
  if ((item.description ?? '').length > limits.maxNoteLength) return tooLong(tr, 'Description', 'Description', limits.maxNoteLength);
  if ((item.notes ?? '').length > limits.maxNoteLength) return tooLong(tr, 'Notes', 'Notes', limits.maxNoteLength);
  if ((item.tags ?? []).length > limits.maxTagsPerItem) return tr(`${limits.maxTagsPerItem} tags maximum`, `${limits.maxTagsPerItem} tags maximum`);
  return null;
}

/** Nombre d'éléments pouvant encore être ajoutés dans le coffre actif */
export function remainingCapacity(data: UnlockedVaultData, vaultId: string, limits: VaultLimits): { credentials: number; tasks: number; vaults: number } {
  return {
    credentials: Math.max(0, limits.maxCredentialsPerVault - data.credentials.filter(c => c.vaultId === vaultId).length),
    tasks: Math.max(0, limits.maxTasksPerVault - data.tasks.filter(t => t.vaultId === vaultId).length),
    vaults: Math.max(0, limits.maxVaults - data.vaults.length)
  };
}
