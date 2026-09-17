# Configuration et sauvegardes

## Variables d'environnement du serveur

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `BETTERVAULT_SECRET` | Secret du serveur, 32 caractères minimum | **requis** |
| `HOST` | Adresse d'écoute | `127.0.0.1` (image Docker : `0.0.0.0`) |
| `PORT` | Port d'écoute | `8787` |
| `BETTERVAULT_DB` | Chemin du fichier SQLite | `server/data/bettervault.db` (Docker : `/data/bettervault.db`) |
| `BETTERVAULT_STATIC` | Dossier de l'application web à servir | aucun (Docker : `/app/dist`) |
| `CORS_ORIGINS` | Origines autorisées à appeler l'API, séparées par des virgules | toutes |
| `TRUST_PROXY` | `true` derrière un reverse proxy, pour identifier les clients via `X-Forwarded-For` | `false` |
| `PUBLIC_URL` | Adresse de l'application, affichée dans les emails | aucune |
| `REGISTRATION_OPEN` | `false` pour refuser les nouveaux comptes | `true` |
| `ADMIN_TOKEN` | Jeton de la page `/admin` (16 caractères minimum), `disabled` pour la désactiver | généré au premier démarrage |

Variables propres à `docker compose` (fichier `.env` à la racine) :

| Variable | Rôle |
| --- | --- |
| `BETTERVAULT_PORT` | Port publié sur `127.0.0.1` |
| `DOMAIN` | Nom de domaine pour le profil `https` |

## Emails (SMTP)

Les emails servent aux codes de réinitialisation du mot de passe et aux alertes de sécurité. Sans `SMTP_HOST`, aucun email n'est envoyé.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `SMTP_HOST` | Serveur SMTP | aucun |
| `SMTP_PORT` | Port | `587` (`465` avec `tls`) |
| `SMTP_SECURITY` | `starttls`, `tls` ou `none` | `starttls` |
| `SMTP_USER` / `SMTP_PASSWORD` | Identifiants (authentification PLAIN) | aucun |
| `SMTP_FROM` | Expéditeur, par exemple `BetterVault <no-reply@exemple.fr>` | `SMTP_USER` |
| `SMTP_ALLOW_INVALID_CERT` | `true` pour un serveur interne au certificat auto-signé | `false` |

!!! tip "Essayer les emails sans serveur SMTP"
    Un collecteur local est fourni : `docker compose --profile mail up -d`, puis
    `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_SECURITY=none`. Les messages s'affichent sur
    <http://127.0.0.1:8025> et ne quittent jamais la machine — pratique pour vérifier le code de
    réinitialisation et les alertes de sécurité.

La page d'administration propose un bouton d'email de test.

## Limites des coffres

Les coffres étant chiffrés avant l'envoi, les applications appliquent ces limites elles-mêmes (elles les lisent sur `GET /api/v1/config`). Le serveur vérifie la taille du coffre chiffré.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `LIMIT_MAX_VAULTS` | Coffres par compte | `20` |
| `LIMIT_MAX_CREDENTIALS_PER_VAULT` | Identifiants par coffre | `5000` |
| `LIMIT_MAX_TASKS_PER_VAULT` | Tâches par coffre | `5000` |
| `LIMIT_MAX_TITLE_LENGTH` | Caractères d'un nom | `200` |
| `LIMIT_MAX_USERNAME_LENGTH` | Caractères d'un identifiant | `500` |
| `LIMIT_MAX_PASSWORD_LENGTH` | Caractères d'un mot de passe | `1000` |
| `LIMIT_MAX_URL_LENGTH` | Caractères d'une URL | `2048` |
| `LIMIT_MAX_NOTE_LENGTH` | Caractères d'une note | `20000` |
| `LIMIT_MAX_CUSTOM_FIELDS` | Champs personnalisés par identifiant | `50` |
| `LIMIT_MAX_TAGS_PER_ITEM` | Tags par élément | `20` |
| `LIMIT_MAX_VAULT_MB` | Taille d'un coffre chiffré, en Mo | `20` |
| `LIMIT_MAX_VAULT_TYPES` | Types de coffres personnalisés par compte | `20` |
| `LIMIT_MAX_MEMBERS_PER_SHARED_VAULT` | Membres d'un coffre partagé | `50` |
| `LIMIT_MAX_ROLES_PER_SHARED_VAULT` | Rôles d'un coffre partagé | `30` |

Les valeurs modifiées sur la [page d'administration](installation.md#page-dadministration) remplacent celles du `.env`.

## Photo de profil

Chaque serveur choisit ce qu'il accepte. L'image n'est servie qu'au compte lui-même : elle n'est jamais publique.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `AVATAR_UPLOADS` | `false` pour refuser l'envoi d'une image | `true` |
| `AVATAR_URLS` | `false` pour refuser un lien vers une image hébergée ailleurs | `true` |
| `LIMIT_MAX_AVATAR_KB` | Taille d'une image envoyée, en Ko | `512` |

Un lien doit être en `https`. Le type réel de l'image envoyée est vérifié d'après ses premiers octets, pas d'après le `Content-Type` annoncé ; le serveur n'accepte que PNG, JPEG et WebP (l'application réencode l'image avant l'envoi). Si les deux options sont sur `false`, le champ disparaît de l'application.

## Limites fixes du serveur

| Élément | Valeur |
| --- | --- |
| Tentatives d'inscription, connexion, récupération, changement de mot de passe | 20 par minute et par adresse |
| Durée d'une session | 30 jours |
| Validité d'un code email de réinitialisation | 15 minutes, 5 essais |
| Mémoire Argon2id minimale acceptée | 19 Mio |

## CORS

L'application web servie par le serveur est sur la même origine que l'API : aucun réglage n'est nécessaire. L'application de bureau et l'extension appellent l'API depuis une autre origine ; la valeur par défaut (toutes les origines) les autorise. Pour restreindre, listez explicitement les origines, par exemple :

```ini
CORS_ORIGINS=https://vault.exemple.fr,chrome-extension://<identifiant>,http://tauri.localhost
```

L'API n'utilise pas de cookies : chaque requête est authentifiée par un jeton de session.

## Sauvegardes

La base contient uniquement des données chiffrées, mais sa perte rend la synchronisation impossible. Sauvegardez-la régulièrement.

=== "Docker"

    ```bash
    docker compose exec bettervault node -e "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync('/data/bettervault.db').exec(\"VACUUM INTO '/data/backup.db'\")"
    ```

    ```bash
    docker compose cp bettervault:/data/backup.db ./bettervault-backup.db
    ```

=== "Sans Docker"

    ```bash
    node -e "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(process.argv[1]).exec(\"VACUUM INTO '\" + process.argv[2] + \"'\")" /var/lib/bettervault/bettervault.db /sauvegardes/bettervault.db
    ```

`VACUUM INTO` produit une copie cohérente même pendant que le serveur fonctionne.

### Restaurer

1. Arrêtez le serveur.
2. Remplacez le fichier de base par la sauvegarde.
3. Redémarrez le serveur.

Les appareils dont la version est plus récente que la sauvegarde renverront leurs modifications à la prochaine synchronisation.

!!! tip
    En plus des sauvegardes du serveur, chaque utilisateur devrait garder un [export chiffré](../guide/import-export.md#sauvegarder-regulierement) récent.
