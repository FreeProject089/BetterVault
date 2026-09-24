# BetterVault

BetterVault réunit un gestionnaire de mots de passe, un authentificateur 2FA et un gestionnaire de tâches dans une seule application, chiffrée de bout en bout.

La même interface fonctionne aujourd'hui dans le **navigateur**, en application de **bureau Windows et Linux**, et sur **Android**. macOS et iOS ne sont pas encore publiés.

## Par où commencer

:::cards{cols=2}
:::card[Utiliser BetterVault]{href=guide/getting-started.md}
Créer un compte, ajouter ses premiers identifiants et codes 2FA.
:::
:::card[Héberger son serveur]{href=deployment/installation.md}
Installer un serveur avec Docker en quelques minutes et y synchroniser ses appareils.
:::
:::card[Comprendre la sécurité]{href=security.md}
Ce qui est chiffré, avec quoi, et ce que le serveur voit réellement.
:::
:::card[Contribuer]{href=development/contributing.md}
Lancer le projet en local, construire les paquets, proposer une modification.
:::
:::

## Ce que fait BetterVault

| | |
| --- | --- |
| **Identifiants** | Mots de passe avec historique, champs personnalisés, passkeys, dates d'expiration |
| **Autres éléments** | Notes sécurisées, cartes bancaires, identités, clés SSH, fichiers et dossiers |
| **2FA** | Codes TOTP, ajout par QR code |
| **Générateur** | Mots de passe et phrases secrètes Diceware |
| **Audit** | Mots de passe faibles, réutilisés, sans 2FA ou présents dans des fuites connues |
| **Tâches** | Liste, Kanban, matrice d'Eisenhower, calendrier, dépendances, récurrences, rappels |
| **Organisation** | Plusieurs coffres, tags colorés, types d'éléments personnalisés |
| **Import / export** | KeePass, 1Password, Bitwarden, FIDO CXF, CSV, JSON chiffré |
| **Synchronisation** | Serveur auto-hébergé qui ne voit jamais les données en clair |

:::warning[Mot de passe principal]
Le mot de passe principal chiffre le coffre. Personne, pas même l'administrateur du serveur, ne peut le récupérer ni déchiffrer vos données sans lui. Gardez la clé de secours affichée à la création du compte.
:::

## Écrire dans cette documentation

Les pages sont en Markdown, avec les blocs **B.MD** (encadrés, étapes, cartes, onglets, questions…). La syntaxe complète est décrite dans le [guide B.MD](https://bettercommunity.ch/blog/markdown-guide) et sur la [page du projet](https://bettercommunity.ch/dev/bmd).
