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

Variables propres à `docker compose` (fichier `.env` à la racine) :

| Variable | Rôle |
| --- | --- |
| `BETTERVAULT_PORT` | Port publié sur `127.0.0.1` |
| `DOMAIN` | Nom de domaine pour le profil `https` |

## Limites appliquées par le serveur

| Élément | Valeur |
| --- | --- |
| Tentatives d'inscription, connexion, changement de mot de passe | 20 par minute et par adresse |
| Durée d'une session | 30 jours |
| Taille maximale d'un coffre | 20 Mio |
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
