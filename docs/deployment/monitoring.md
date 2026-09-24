# Supervision du serveur

La page `/admin`, onglet **Tableau de bord**, donne l'état du serveur sans exposer de données personnelles : aucune adresse email, aucune adresse IP, aucun contenu de coffre n'y apparaît.

## Ce qui est affiché

| Bloc | Contenu |
| --- | --- |
| Activité | Comptes, actifs sur 24 h / 7 j / 30 j, sessions ouvertes, part des comptes avec double authentification et clé de secours, inscriptions des 30 derniers jours |
| Stockage | Octets des coffres personnels et partagés, pièces jointes, taille du fichier de base, espace disque |
| Performances | Temps de fonctionnement, CPU, mémoire, latences (p50/p95/p99), retard de la boucle d'événements, requêtes par minute sur la dernière heure, routes les plus appelées |
| Contrôles de sécurité | HTTPS, sauvegardes chiffrées et automatiques, emails, documents légaux, base de localisation, inscriptions ouvertes ou fermées |

Les compteurs de requêtes vivent en mémoire : ils repartent de zéro à chaque redémarrage. Les routes sont enregistrées sous forme de motif (`GET /api/v1/vaults/:id`), sans identifiant.

## Journal de sécurité

L'onglet **Journal** liste les événements sensibles : création et suppression de compte, activation ou arrêt de la double authentification, changement de mot de passe, fermeture de sessions, partage de coffre, abonnement, actions d'administration.

Chaque événement désigne le compte par un **pseudonyme** (HMAC du secret du serveur et de l'identifiant du compte) : on peut relier les événements d'un même compte sans connaître son adresse email. Le journal est conservé 90 jours, puis purgé automatiquement.

## Copie chiffrée de la base

L'onglet **Tableau de bord** propose un téléchargement immédiat de la base, utile avant une migration ou une mise à jour :

1. saisissez une phrase de chiffrement d'au moins 12 caractères ;
2. le serveur crée une copie cohérente (`VACUUM INTO`), la compresse puis la chiffre (scrypt + AES-256-GCM) ;
3. le fichier `bettervault-AAAA-MM-JJ.db.gz.enc` est téléchargé.

Restauration :

```bash
node server/tools/decrypt-backup.ts bettervault-2026-09-16.db.gz.enc bettervault.db
```

La phrase n'est stockée nulle part : sans elle, le fichier est inutilisable. Les coffres qu'il contient restent de toute façon chiffrés par les mots de passe des utilisateurs.

Pour des sauvegardes régulières vers un stockage S3, voir [Sauvegardes S3 et RGPD](backups.md).
