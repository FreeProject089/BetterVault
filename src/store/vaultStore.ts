import { UnlockedVaultData } from '../types/vault';

const STORAGE_KEY = 'bum_vault_data_v1';

export const INITIAL_VAULT_DATA: UnlockedVaultData = {
  vaults: [
    { id: 'vault-perso', name: 'Personnel', type: 'personal', passwordProtected: false, isLocked: false },
    { id: 'vault-work', name: 'Professionnel', type: 'work', passwordProtected: false, isLocked: false },
    { id: 'vault-secure', name: 'Ultra Sécurisé', type: 'team', passwordProtected: true, passwordHash: '0a2569752b55b3f7bebbd8cbff61099042b406e6ff70ffef433177696e54ef86', isLocked: true }
  ],
  activeVaultId: 'vault-perso',
  credentials: [
    {
      id: 'cred-1',
      vaultId: 'vault-perso',
      title: 'GitHub Enterprise',
      username: 'freeproject@dev.local',
      password: 'm9$Zk!7Lp#wQ2vXy&99R',
      website: 'https://github.com',
      domain: 'github.com',
      totpSecret: 'JBSWY3DPEHPK3PXP', // Clé de test standard RFC
      notes: 'Clé SSH ED25519 associée sauvegardée sur YubiKey.\nAccès aux dépôts core et CI/CD.',
      tags: ['Dev', 'Prod', '2FA'],
      isFavorite: true,
      passkeys: [
        {
          credentialId: 'YXBwbGUtcGFzc2tleS1pZA==',
          publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
          signCount: 14,
          rpId: 'github.com',
          userName: 'freeproject@dev.local',
          createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30
        }
      ],
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 60,
      updatedAt: Date.now() - 1000 * 60 * 60 * 2
    },
    {
      id: 'cred-2',
      vaultId: 'vault-perso',
      title: 'AWS Console Root',
      username: 'cloud-admin@infra.org',
      password: 'Hk8#sP9!vW3*mQ1$zT6x',
      website: 'https://aws.amazon.com',
      domain: 'aws.amazon.com',
      totpSecret: 'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ',
      notes: 'Compte racine AWS (Billing, Security Hub). Règle IAM: accès restreint.',
      tags: ['Cloud', 'Infra'],
      isFavorite: true,
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24
    },
    {
      id: 'cred-3',
      vaultId: 'vault-work',
      title: 'Google Workspace Enterprise',
      username: 'lead@startup-core.io',
      password: 'aB8*yU1!qP4$rT9^wK2m',
      website: 'https://accounts.google.com',
      domain: 'google.com',
      totpSecret: 'KRSXG5CTMVRXEZLUKN2XAZLSPE======',
      notes: 'SSO entreprise avec accès Slack, Notion, Jira et Stripe.',
      tags: ['Work', 'SSO'],
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 15,
      updatedAt: Date.now()
    },
    {
      id: 'cred-4',
      vaultId: 'vault-perso',
      title: 'Proton Mail Ultra-Secure',
      username: 'secret-ops@proton.me',
      password: 'p9$Tx7!qZ2#vB4&mL8*r',
      website: 'https://proton.me',
      domain: 'proton.me',
      totpSecret: 'MFRGGZDFMY2TINJTGQ======',
      notes: 'Boîte chiffrée PGP dédiée aux alertes critiques de monitoring.',
      tags: ['Privacy'],
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 120,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 10
    }
  ],
  tasks: [
    {
      id: 'task-1',
      vaultId: 'vault-perso',
      title: 'Renouveler la clé d\'accès API et Token TOTP',
      description: 'Mettre à jour les jetons de déploiement automatique sur le dépôt GitHub Enterprise.',
      status: 'in_progress',
      priority: 'urgent',
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString().split('T')[0],
      linkedCredentialId: 'cred-1',
      tags: ['DevOps', 'Sécurité'],
      createdAt: Date.now() - 1000 * 60 * 60 * 12,
      updatedAt: Date.now()
    },
    {
      id: 'task-2',
      vaultId: 'vault-perso',
      title: 'Activer la double authentification FIDO2 matérielle',
      description: 'Configurer la deuxième YubiKey de secours sur la console AWS racine.',
      status: 'todo',
      priority: 'high',
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().split('T')[0],
      linkedCredentialId: 'cred-2',
      tags: ['Infra', 'Audit'],
      createdAt: Date.now() - 1000 * 60 * 60 * 24,
      updatedAt: Date.now()
    },
    {
      id: 'task-3',
      vaultId: 'vault-work',
      title: 'Revue trimestrielle des permissions SSO Workspace',
      description: 'Vérifier la liste des comptes tiers connectés et révoquer les accès inactifs.',
      status: 'todo',
      priority: 'medium',
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().split('T')[0],
      linkedCredentialId: 'cred-3',
      tags: ['Gouvernance'],
      createdAt: Date.now() - 1000 * 60 * 60 * 48,
      updatedAt: Date.now()
    }
  ]
};

export class VaultStore {
  private data: UnlockedVaultData;
  private listeners: (() => void)[] = [];

  constructor() {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        this.data = JSON.parse(cached);
      } catch {
        this.data = INITIAL_VAULT_DATA;
      }
    } else {
      this.data = INITIAL_VAULT_DATA;
      this.save();
    }
  }

  public getData(): UnlockedVaultData {
    return this.data;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(): void {
    this.save();
    this.listeners.forEach(l => l());
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error('Erreur sauvegarde locale:', e);
    }
  }

  public setActiveVault(vaultId: string): void {
    this.data.activeVaultId = vaultId;
    this.notify();
  }

  public addVault(name: string, type: 'personal' | 'work' | 'team', passwordHash?: string): string {
    const id = 'vault-' + Math.random().toString(36).substring(2, 9);
    this.data.vaults.push({
      id,
      name,
      type,
      passwordProtected: !!passwordHash,
      passwordHash: passwordHash || undefined,
      isLocked: false
    });
    this.data.activeVaultId = id;
    this.notify();
    return id;
  }

  public setVaultPassword(vaultId: string, passwordHash: string): void {
    const v = this.data.vaults.find(vault => vault.id === vaultId);
    if (v) {
      v.passwordProtected = true;
      v.passwordHash = passwordHash;
      this.notify();
    }
  }

  public removeVaultPassword(vaultId: string): void {
    const v = this.data.vaults.find(vault => vault.id === vaultId);
    if (v) {
      v.passwordProtected = false;
      v.passwordHash = undefined;
      v.isLocked = false;
      this.notify();
    }
  }

  public lockVault(vaultId: string): void {
    const v = this.data.vaults.find(vault => vault.id === vaultId);
    if (v && v.passwordProtected) {
      v.isLocked = true;
      this.notify();
    }
  }

  public unlockVault(vaultId: string, inputHash: string): boolean {
    const v = this.data.vaults.find(vault => vault.id === vaultId);
    if (v && v.passwordProtected) {
      if (v.passwordHash === inputHash) {
        v.isLocked = false;
        this.notify();
        return true;
      }
      return false;
    }
    return true;
  }

  /** Déverrouillage après vérification biométrique WebAuthn réussie */
  public unlockVaultWithBiometrics(vaultId: string): void {
    const v = this.data.vaults.find(vault => vault.id === vaultId);
    if (v?.isLocked) {
      v.isLocked = false;
      this.notify();
    }
  }

  public addCredential(item: Omit<UnlockedVaultData['credentials'][0], 'id' | 'createdAt' | 'updatedAt'>): void {
    const newItem = {
      ...item,
      id: 'cred-' + Math.random().toString(36).substring(2, 9),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.data.credentials.unshift(newItem);
    this.notify();
  }

  public updateCredential(id: string, updates: Partial<UnlockedVaultData['credentials'][0]>): void {
    const idx = this.data.credentials.findIndex(c => c.id === id);
    if (idx !== -1) {
      const current = this.data.credentials[idx];
      let history = current.passwordHistory || [];

      // Si le mot de passe change, enregistrer l'ancien dans l'historique
      if (updates.password && updates.password !== current.password) {
        history = [
          { password: current.password, changedAt: Date.now() },
          ...history.slice(0, 9) // garder les 10 derniers
        ];
      }

      this.data.credentials[idx] = {
        ...current,
        ...updates,
        passwordHistory: history,
        updatedAt: Date.now()
      };
      this.notify();
    }
  }

  public deleteCredential(id: string): void {
    this.data.credentials = this.data.credentials.filter(c => c.id !== id);
    // Détacher aussi les tâches liées
    this.data.tasks = this.data.tasks.map(t => t.linkedCredentialId === id ? { ...t, linkedCredentialId: undefined } : t);
    this.notify();
  }

  public addTask(task: Omit<UnlockedVaultData['tasks'][0], 'id' | 'createdAt' | 'updatedAt'>): void {
    const newTask = {
      ...task,
      id: 'task-' + Math.random().toString(36).substring(2, 9),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.data.tasks.unshift(newTask);
    this.notify();
  }

  public updateTask(id: string, updates: Partial<UnlockedVaultData['tasks'][0]>): void {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.data.tasks[idx] = {
        ...this.data.tasks[idx],
        ...updates,
        updatedAt: Date.now()
      };
      this.notify();
    }
  }

  public deleteTask(id: string): void {
    this.data.tasks = this.data.tasks
      .filter(t => t.id !== id)
      .map(t => t.dependsOn?.includes(id) ? { ...t, dependsOn: t.dependsOn.filter(d => d !== id) } : t);
    this.notify();
  }

  public importBulk(credentials: Partial<UnlockedVaultData['credentials'][0]>[], tasks: Partial<UnlockedVaultData['tasks'][0]>[]): void {
    const activeVaultId = this.data.activeVaultId || 'vault-perso';
    const domainOf = (website?: string): string => {
      if (!website) return '';
      try {
        return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : 'https://' + website).hostname;
      } catch {
        return '';
      }
    };

    const newCreds = credentials.map(c => ({
      id: 'cred-' + Math.random().toString(36).substring(2, 9),
      vaultId: activeVaultId,
      title: c.title || 'Importé',
      username: c.username || '',
      password: c.password || '',
      website: c.website || '',
      domain: domainOf(c.website),
      totpSecret: c.totpSecret,
      passkeys: c.passkeys,
      fields: c.fields,
      isFavorite: c.isFavorite,
      expiresAt: c.expiresAt,
      notes: c.notes || '',
      tags: c.tags?.length ? c.tags : ['Import'],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }));

    const newTasks = tasks.map(t => ({
      id: 'task-' + Math.random().toString(36).substring(2, 9),
      vaultId: activeVaultId,
      title: t.title || 'Tâche importée',
      status: t.status || 'todo',
      priority: t.priority || 'medium',
      tags: t.tags || ['Import'],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }));

    this.data.credentials = [...newCreds, ...this.data.credentials];
    this.data.tasks = [...newTasks, ...this.data.tasks];
    this.notify();
  }
}

export const vaultStore = new VaultStore();
