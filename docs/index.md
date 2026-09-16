# BetterVault

BetterVault réunit un gestionnaire de mots de passe, un authentificateur 2FA et un gestionnaire de tâches dans une seule application, chiffrée de bout en bout.

La même interface fonctionne dans le navigateur, en application de bureau (Windows, macOS, Linux), sur mobile (Android, iOS) et en extension de navigateur.

## Ce que fait BetterVault

- **Identifiants** : mots de passe avec historique, champs personnalisés, passkeys, dates d'expiration
- **Autres types d'éléments** : notes sécurisées, cartes bancaires, identités, clés SSH, fichiers et dossiers de fichiers
- **2FA** : codes TOTP, ajout par QR code
- **Générateur** : mots de passe et phrases secrètes Diceware
- **Audit** : mots de passe faibles, réutilisés, sans 2FA ou présents dans des fuites connues
- **Tâches** : liste, Kanban, matrice d'Eisenhower, calendrier, dépendances, récurrences, rappels
- **Organisation** : plusieurs coffres, dossiers en arborescence, tags colorés
- **Import / export** : KeePass, 1Password, Bitwarden, FIDO CXF, CSV, JSON chiffré
- **Synchronisation** : serveur auto-hébergé qui ne voit jamais les données en clair

## Par où commencer

<div class="grid cards" markdown>

- **Utiliser BetterVault** — créer un compte, ajouter ses identifiants : [Premiers pas](guide/premiers-pas.md)
- **Héberger son serveur** — synchroniser plusieurs appareils : [Docker](deploiement/docker.md)
- **Comprendre la sécurité** — ce qui est chiffré et comment : [Sécurité](securite.md)
- **Contribuer** — lancer le projet en local : [Contribuer](developpement/contribuer.md)
- **Construire les paquets** — bureau, mobile, extension, Docker : [Construire l'application](developpement/build.md)

</div>

!!! warning "Mot de passe principal"
    Le mot de passe principal chiffre le coffre. Personne, pas même l'administrateur du serveur, ne peut le récupérer ni déchiffrer vos données sans lui.
