import type { ItemVersion, ItemConflict } from '../store/versions';
import type { ItemIcon } from '../icons/iconLibrary';
import type { CardData, IdentityData, ItemType, SshKeyData } from './itemTypes';
import type { AttachmentMeta } from '../account/attachmentCrypto';
import type { SharedRole } from '../account/cloudClient';

/** Coffre partagé : rôle du compte courant (information d'affichage, jamais enregistrée dans le coffre personnel) */
export interface SharedVaultInfo {
  role: SharedRole;
  ownerEmail: string;
}

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'blocked';

export interface SubTask {
  id: string;
  title: string;
  isDone: boolean;
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface TaskRecurrence {
  freq: RecurrenceFrequency;
  interval: number;
  until?: string; // ISO date (inclusive)
}

export interface Task {
  id: string;
  vaultId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: Priority;
  dueDate?: string; // ISO date string
  linkedCredentialId?: string;
  tags: string[];
  subtasks?: SubTask[];
  notes?: string;
  recurrence?: TaskRecurrence;
  dependsOn?: string[]; // IDs des tâches à terminer avant celle-ci
  reminderAt?: number;  // Timestamp du rappel
  reminderSent?: boolean;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
  rev?: string;
  history?: ItemVersion[];
  conflicts?: ItemConflict[];
}

export interface CredentialField {
  id: string;
  label: string;
  value: string;
  isMasked: boolean;
}

export interface PasskeyData {
  credentialId: string; // Base64
  publicKey: string;    // Base64 / PEM
  signCount: number;
  aaguid?: string;
  rpId: string;
  userName: string;
  userDisplayName?: string;
  userHandle?: string;  // Base64url
  privateKey?: string;  // PKCS#8 Base64url (champ "key" du format FIDO CXF)
  createdAt: number;
}

export interface CredentialItem {
  id: string;
  vaultId: string;
  /** Absent sur les coffres d'avant les types : l'élément est alors un identifiant */
  type?: ItemType;
  /** Dossier de rangement, dans le coffre ; absent = à la racine */
  folderId?: string;
  title: string;
  username: string;
  password: string;
  website: string;
  domain: string;
  totpSecret?: string; // RFC 6238 Base32 secret
  passkeys?: PasskeyData[];
  notes?: string;
  fields?: CredentialField[];
  passwordHistory?: { password: string; changedAt: number }[];
  isFavorite?: boolean;
  /** Icône choisie (sinon détectée depuis le site) */
  icon?: ItemIcon;
  /** Fichiers chiffrés stockés sur le serveur ; leur clé est ici, dans le coffre chiffré */
  attachments?: AttachmentMeta[];
  /** Champs propres au type ; une seule de ces clés est renseignée à la fois */
  card?: CardData;
  identity?: IdentityData;
  sshKey?: SshKeyData;
  tags: string[];
  expiresAt?: number; // Timestamp d'expiration ou de rappel de renouvellement
  createdAt: number;
  updatedAt: number;
  /** Version courante, versions précédentes et valeurs concurrentes (store/versions.ts) */
  rev?: string;
  history?: ItemVersion[];
  conflicts?: ItemConflict[];
}

export interface VaultMetadata {
  id: string;
  name: string;
  /** « personal », « work », « team » ou l'identifiant d'un type créé dans ce coffre */
  type: string;
  icon?: ItemIcon;
  shared?: SharedVaultInfo;
  createdAt: number;
  updatedAt: number;
}

export interface TagDef {
  id: string;
  name: string;
  color: string;
  icon?: ItemIcon;
  createdAt: number;
  updatedAt: number;
}

/** Type de coffre créé par l'utilisateur, en plus de « Personnel », « Travail » et « Équipe » */
export interface VaultTypeDef {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** Dossier de rangement à l'intérieur d'un coffre ; les dossiers peuvent s'imbriquer */
export interface FolderDef {
  id: string;
  vaultId: string;
  /** Dossier parent ; absent = à la racine du coffre */
  parentId?: string;
  name: string;
  icon?: ItemIcon;
  createdAt: number;
  updatedAt: number;
}

export interface UnlockedVaultData {
  vaults: VaultMetadata[];
  activeVaultId: string;
  credentials: CredentialItem[];
  tasks: Task[];
  tagDefs: TagDef[];
  folders: FolderDef[];
  vaultTypes?: VaultTypeDef[];
  /** Suppressions synchronisables : id de l'élément → horodatage de suppression */
  deleted: Record<string, number>;
  /** Éléments supprimés récemment, restaurables pendant 30 jours */
  trash?: TrashEntry[];
}

export interface TrashEntry {
  kind: 'credential' | 'task';
  item: CredentialItem | Task;
  deletedAt: number;
}
