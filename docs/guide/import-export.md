# Import et export

Ouvrez **Importer / exporter**. Import et export portent sur le **coffre actif**.

## Importer

Glissez un fichier dans la zone ou cliquez pour le choisir. Le format est détecté automatiquement.

| Source | Formats | Remarques |
| --- | --- | --- |
| KeePass / KeePassXC | `.kdbx` (3.1, 4.x), `.xml` | Mot de passe principal et fichier clé optionnel ; AES-256 et ChaCha20 |
| 1Password | `.1pux`, CSV | |
| Bitwarden | JSON, CSV | Passkeys et champs personnalisés inclus |
| FIDO CXF | JSON | Identifiants, passkeys, 2FA, notes |
| LastPass, Dashlane, Chrome, Firefox | CSV | |
| Passky | JSON | Export non chiffré (Paramètres › Exporter) : site, identifiant, mot de passe et message |
| BetterVault | JSON, JSON chiffré, CSV | |

Pour un fichier protégé (KeePass, export chiffré), BetterVault demande le mot de passe avant de lire le contenu. Le nombre d'éléments trouvés s'affiche avant la confirmation.

!!! note
    Les bases KeePass chiffrées avec Twofish ne sont pas prises en charge.

## Exporter

=== "Formats chiffrés (recommandés)"

    | Format | Usage |
    | --- | --- |
    | **Export chiffré** | Sauvegarde BetterVault protégée par un mot de passe dédié (Argon2id + AES-256-GCM) |
    | **KeePass `.kdbx` 4** | Ouverture dans KeePass, KeePassXC, Strongbox |

    Le mot de passe d'export doit contenir au moins 10 caractères. Il est distinct du mot de passe principal.

=== "Formats en clair"

    | Format | Usage |
    | --- | --- |
    | **FIDO CXF** | Transfert vers un autre gestionnaire, passkeys comprises |
    | **JSON BetterVault** | Copie complète lisible |
    | **CSV** | Compatible Bitwarden et tableurs, tags en dernière colonne |

    Une confirmation est demandée : quiconque obtient ces fichiers lit tous vos secrets. Supprimez-les après usage.

Sur l'application de bureau, les fichiers sont enregistrés dans le dossier **Téléchargements** ; le chemin est affiché.

## Sauvegarder régulièrement

Même avec la synchronisation, conservez un **export chiffré** récent dans un endroit sûr (clé USB, stockage externe). Il permet de tout restaurer sans serveur.
