# Sauvegardes et RGPD

Le serveur peut sauvegarder automatiquement sa base et les pièces jointes vers un stockage compatible S3.

## Avec le MinIO fourni

Dans `.env` :

```ini
BACKUP_ENABLED=true
BACKUP_ENCRYPTION_KEY=une longue phrase gardée hors du serveur
BACKUP_S3_ENDPOINT=http://minio:9000
BACKUP_S3_BUCKET=bettervault-backups
BACKUP_S3_ACCESS_KEY=bettervault
BACKUP_S3_SECRET_KEY=un-mot-de-passe-minio-de-8-caracteres-ou-plus
```

```bash
docker compose --profile backup up -d
```

Le bucket est créé automatiquement. La console MinIO est sur `http://127.0.0.1:9001` depuis la machine hôte.

!!! tip "Hors de la machine"
    Un MinIO sur le même disque protège contre une erreur de manipulation, pas contre la perte du disque. Pour une vraie copie, montez son volume sur un autre disque ou utilisez un S3 externe.

## Avec un S3 externe

Ne lancez pas le profil `backup` et renseignez le service choisi :

| Service | `BACKUP_S3_ENDPOINT` | `BACKUP_S3_PATH_STYLE` |
| --- | --- | --- |
| AWS S3 | `https://s3.eu-west-3.amazonaws.com` | `false` |
| Backblaze B2 | `https://s3.eu-central-003.backblazeb2.com` | `true` |
| Scaleway | `https://s3.fr-par.scw.cloud` | `true` |
| OVHcloud | `https://s3.gra.io.cloud.ovh.net` | `true` |
| MinIO / Garage auto-hébergé | adresse de votre instance | `true` |

Renseignez aussi `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET` et les clés d'accès. La page `/admin` permet de tout modifier, de **tester le stockage** et de **sauvegarder maintenant**.

## Ce qui est sauvegardé

| Élément | Chemin dans le bucket | Chiffrement |
| --- | --- | --- |
| Base SQLite (copie cohérente, compressée) | `db/bettervault-<date>.db.gz.enc` | Déjà chiffrée côté client, plus AES-256-GCM avec `BACKUP_ENCRYPTION_KEY` |
| Pièces jointes | `files/<id>` | Chiffrées côté client, envoyées une seule fois |

Sans `BACKUP_ENCRYPTION_KEY`, la copie de la base n'est pas chiffrée en plus : les coffres restent illisibles, mais les emails des comptes et les métadonnées sont en clair. La page d'administration l'indique.

## Restaurer

1. Téléchargez la copie voulue depuis le bucket.
2. Déchiffrez-la :

    ```bash
    BACKUP_ENCRYPTION_KEY="…" node server/tools/decrypt-backup.ts bettervault-2026-09-15.db.gz.enc bettervault.db
    ```

3. Arrêtez le serveur, remplacez le fichier de base par `bettervault.db`, redémarrez.
4. Copiez le dossier `files/` du bucket dans le dossier des pièces jointes (`/data/files` dans Docker) si nécessaire.

## RGPD

| Principe | Comment BetterVault s'y conforme |
| --- | --- |
| Minimisation | Le serveur ne détient que l'email, des empreintes d'authentification et des données chiffrées côté client. Il ne peut lire ni les mots de passe ni les fichiers. |
| Sécurité | Chiffrement de bout en bout, sauvegardes chiffrées en plus, clés jamais envoyées au serveur. |
| Fréquence | `BACKUP_INTERVAL_HOURS` (24 heures par défaut) : délai entre deux sauvegardes automatiques. |
| Durée de conservation | `BACKUP_RETENTION_DAYS` (30 jours par défaut) : les copies plus anciennes sont supprimées à chaque sauvegarde. |
| Droit à l'effacement | Supprimer un compte ou un fichier l'efface immédiatement du serveur. Les copies de sauvegarde qui le contiennent disparaissent au plus tard après la durée de conservation ; les pièces jointes supprimées sont retirées du bucket au même rythme. |
| Portabilité | Chaque utilisateur exporte ses données (JSON chiffré, KeePass, CXF, CSV). |
| Journalisation | Pas de journal des accès : les adresses IP ne servent qu'à limiter les tentatives, en mémoire, et à l'email d'alerte de connexion si les emails sont activés. |

En tant qu'hébergeur, vous restez responsable du traitement : informez vos utilisateurs de la durée de conservation des sauvegardes et du lieu d'hébergement du stockage S3 (idéalement dans l'Union européenne).
