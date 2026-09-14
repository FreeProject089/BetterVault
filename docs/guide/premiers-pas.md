# Premiers pas

## Créer un compte

Au premier lancement, BetterVault affiche l'écran **Créer un compte**.

1. Saisissez votre adresse email.
2. Choisissez un **mot de passe maître** d'au moins 10 caractères. La jauge indique sa robustesse ; une phrase de plusieurs mots est un bon choix.
3. Confirmez le mot de passe.
4. Choisissez le **stockage** :

    | Mode | Où sont les données | Quand le choisir |
    | --- | --- | --- |
    | **Cet appareil** | Chiffrées dans le stockage local de l'appareil uniquement | Un seul appareil, aucun serveur |
    | **Synchronisé** | Chiffrées sur l'appareil et sur un serveur BetterVault | Plusieurs appareils |

5. En mode synchronisé, indiquez l'adresse du serveur (voir [Docker](../deploiement/docker.md)).
6. Cliquez sur **Créer le coffre**.

!!! warning
    Il n'existe aucune procédure de récupération du mot de passe maître. Notez-le dans un endroit sûr.

Un compte local peut être synchronisé plus tard : voir [Compte et synchronisation](synchronisation.md#activer-la-synchronisation).

## Se connecter sur un autre appareil

Sur l'écran d'accueil, ouvrez l'onglet **Se connecter**, puis saisissez l'adresse du serveur, l'email et le mot de passe maître. Le coffre est téléchargé chiffré puis déchiffré sur l'appareil.

## Déverrouiller et verrouiller

- À chaque ouverture, BetterVault demande le mot de passe maître.
- Pour verrouiller : bouton cadenas en bas de la barre latérale, ou ++ctrl+l++.
- Le verrouillage est automatique après **5 minutes** sans activité.

Au verrouillage, les clés sont effacées de la mémoire et les données déchiffrées sont retirées de l'écran.

## Découvrir l'interface

- **Barre latérale** : coffres, catégories (identifiants, codes 2FA, tâches), tags, outils, état de la synchronisation.
- **Colonne centrale** : liste filtrable, recherche avec ++ctrl+k++, bouton **Nouveau**.
- **Colonne de droite** : fiche détaillée de l'élément sélectionné.

## Ajouter un premier identifiant

1. Cliquez sur **Nouveau** (ou ++ctrl+n++).
2. Renseignez le nom du service, l'URL, l'identifiant et le mot de passe.
3. Pour un mot de passe robuste, cliquez sur **Générer** puis **Utiliser ce mot de passe**.
4. Cliquez sur **Créer l'identifiant**.

Pour importer des identifiants depuis un autre gestionnaire, voir [Import et export](import-export.md).
