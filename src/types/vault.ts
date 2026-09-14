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
  tags: string[];
  expiresAt?: number; // Timestamp d'expiration ou de rappel de renouvellement
  createdAt: number;
  updatedAt: number;
}

export interface VaultMetadata {
  id: string;
  name: string;
  type: 'personal' | 'work' | 'team';
  createdAt: number;
  updatedAt: number;
}

export interface TagDef {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface EncryptedVaultPayload {
  version: number;
  kdf: 'Argon2id' | 'PBKDF2-SHA256';
  salt: string;        // Base64
  iterations?: number;
  memoryCost?: number;
  cipher: 'AES-256-GCM';
  iv: string;          // Base64
  ciphertext: string;  // Base64
  authTag: string;     // Base64 (si non concaténé)
}

export interface UnlockedVaultData {
  vaults: VaultMetadata[];
  activeVaultId: string;
  credentials: CredentialItem[];
  tasks: Task[];
  tagDefs: TagDef[];
  /** Suppressions synchronisables : id de l'élément → horodatage de suppression */
  deleted: Record<string, number>;
}
