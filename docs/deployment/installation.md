# Installation rapide

Le script d'installation pose quelques questions, crée le fichier `.env` et démarre le serveur avec Docker.

=== "Linux / macOS"

    ```bash
    git clone <adresse du dépôt> bettervault
    cd bettervault
    ./scripts/install.sh
    ```

=== "Windows"

    ```powershell
    git clone <adresse du dépôt> bettervault
    cd bettervault
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1
    ```

Questions posées :

| Question | Effet |
| --- | --- |
| Nom de domaine | Avec un domaine, Caddy obtient un certificat HTTPS (profil `https`). Sans domaine, le serveur n'écoute que sur la machine. |
| Création de comptes | `REGISTRATION_OPEN` : fermez-la une fois vos comptes créés. |
| Serveur SMTP | Codes de réinitialisation et alertes de sécurité. Vide : aucun email. |
| Limites | Identifiants par coffre, taille des notes, taille d'un coffre. |

Le secret du serveur et le jeton d'administration sont générés aléatoirement. Le script affiche l'adresse de la page d'administration et son jeton à la fin.

## Page d'administration

Ouvrez `https://votre-domaine/admin` et collez le jeton d'administration (`ADMIN_TOKEN`).

- **Statistiques** : nombre de comptes, comptes avec double authentification, volume des coffres stockés.
- **Général** : adresse publique affichée dans les emails, ouverture des inscriptions.
- **Limites** : appliquées par les applications avant le chiffrement ; le serveur vérifie la taille du coffre.
- **SMTP** : hôte, port, sécurité, identifiants, expéditeur, bouton d'email de test.

Les réglages enregistrés sur cette page sont conservés dans la base et remplacent ceux du `.env`.

!!! tip "Sans ADMIN_TOKEN"
    Si `ADMIN_TOKEN` est vide, un jeton est généré au premier démarrage et affiché une seule fois dans les journaux :
    `docker compose logs bettervault`. Mettez `ADMIN_TOKEN=disabled` pour désactiver la page.
