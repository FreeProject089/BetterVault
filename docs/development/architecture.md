# Architecture

## Vue d'ensemble

```text
┌───────────────────────── Interface (TypeScript, sans framework) ─────────────────────────┐
│  Web  ·  Bureau et mobile (Tauri)  ·  Extension (popup + application complète)            │
│                                                                                            │
│  main.ts ─── vaultStore (état déchiffré en mémoire) ─── accountService (clés, stockage)    │
│                                                         │                                  │
│                                                         └── cloudClient ── HTTPS ──┐       │
└────────────────────────────────────────────────────────────────────────────────────┼───────┘
                                                                                     ▼
                                                           server/ (Node.js + SQLite)
```

## Dossiers

| Dossier | Contenu |
| --- | --- |
| `src/account/` | Compte : dérivation des clés, service de compte, client HTTP, fusion des versions |
| `src/store/` | `VaultStore` : état du coffre déchiffré, coffres, identifiants, tâches, tags |
| `src/tasks/` | Règles des tâches : Eisenhower, récurrences, dépendances, rappels |
| `src/crypto/` | Entropie, générateurs, liste EFF, TOTP, QR code, Have I Been Pwned |
| `src/import_export/` | KeePass, 1Password, Bitwarden, CXF, CSV, exports chiffrés |
| `src/ui/` | Écran de compte, saisie de tags |
| `src/extension/` | Popup et fonction de remplissage |
| `src/platform/` | Pont vers Tauri (Argon2id natif, fichiers, trousseau) |
| `server/` | API de synchronisation |
| `src-tauri/` | Cœur Rust et configuration Tauri |
| `extension/` | Manifeste et page du popup |
| `tests/` | Tests Vitest, dont serveur réel et synchronisation multi-appareils |

## Flux de données

### Déverrouillage

1. `accountService.unlock(motDePasse)` dérive les clés et déchiffre la clé du coffre.
2. Le coffre chiffré local est déchiffré.
3. `vaultStore.load(données)` charge l'état ; l'interface s'affiche.
4. `vaultStore.setPersistence(...)` branche l'enregistrement : chaque modification appelle `accountService.save`.

### Modification

1. Une action de l'interface appelle une méthode du store (`addCredential`, `updateTag`…).
2. Le store met à jour l'élément (`updatedAt`) et notifie l'interface.
3. `accountService.save` chiffre et écrit localement, puis programme une synchronisation (1,5 s).

### Synchronisation

1. Lecture de la version serveur (`GET /api/v1/vault`).
2. Si le serveur est plus récent : fusion avec les changements locaux non envoyés.
3. Envoi (`PUT /api/v1/vault` avec la révision de base).
4. En cas de conflit (`409`), fusion avec la version renvoyée par le serveur, puis nouvel essai.
5. Les données fusionnées sont rechargées dans le store.

### Fusion

`mergeVaultData` combine deux versions élément par élément (coffres, identifiants, tâches, tags) : la version avec le `updatedAt` le plus récent est gardée. Les suppressions sont enregistrées dans `deleted` (identifiant → date) et l'emportent sur les modifications antérieures.

## Format des données

`UnlockedVaultData` (défini dans `src/types/vault.ts`) :

```ts
interface UnlockedVaultData {
  vaults: VaultMetadata[];
  activeVaultId: string;
  credentials: CredentialItem[];
  tasks: Task[];
  tagDefs: TagDef[];
  folders: FolderDef[];
  vaultTypes?: VaultTypeDef[];
  deleted: Record<string, number>;
}
```

Chaque `CredentialItem` porte un `type` (`login`, `note`, `card`, `identity`, `sshKey`, `file`, `folder`)
et range les champs propres à ce type dans sa propre clé (`card`, `identity`, `sshKey`). Un élément
**sans type enregistré est un identifiant** : les coffres créés avant les types se lisent tels quels.

Les `FolderDef` rangent les éléments en arborescence à l'intérieur d'un coffre : un dossier a un
`vaultId`, un `parentId` facultatif, et un élément pointe vers son dossier par `folderId`.

Les anciennes données sont migrées par `normalizeVaultData` au chargement, qui répare aussi les
dossiers orphelins et les boucles de parents.

## Dossiers du dépôt

Le tableau plus haut liste les dossiers de sources. Voir [Choix techniques](technical.md) pour le
raisonnement derrière ces découpages, et [Construire l'application](build.md) pour produire chaque paquet.
