# Mesures de sécurité

Mesures techniques et organisationnelles (annexe du DPA). Les pratiques sont alignées sur les contrôles de l’ISO/IEC 27001:2022 (annexe A) ; **ce serveur n’est pas certifié** sauf mention contraire de l’Exploitant.

## Zéro connaissance

| Mesure | Détail |
| --- | --- |
| Chiffrement côté client | AES-256-GCM pour les coffres, coffres partagés et pièces jointes |
| Dérivation de clé | Argon2id (64 Mio, 3 itérations), séparation HKDF entre clé de chiffrement et preuve d’authentification |
| Mot de passe principal | Jamais transmis ; le serveur ne stocke qu’une preuve dérivée protégée par scrypt |
| Partage | Clés X25519 par compte ; la clé d’un coffre partagé est scellée pour chaque membre ; rotation de clé au retrait d’un membre |
| Récupération | Clé de secours de 256 bits détenue par l’utilisateur seul |

## Zéro confiance

| Contrôle ISO 27001 | Mesure |
| --- | --- |
| 5.15 Contrôle d’accès | Chaque requête est authentifiée par un jeton de session ; les permissions des coffres partagés sont vérifiées par le serveur à chaque action |
| 5.17 Informations d’authentification | Jetons de session aléatoires de 256 bits stockés uniquement sous forme d’empreinte SHA-256 ; double authentification TOTP sans réutilisation de code |
| 8.5 Authentification sécurisée | Limitation des tentatives par adresse ; réponse identique que le compte existe ou non |
| 5.18 Droits d’accès | Sessions consultables et révocables par l’utilisateur (mot de passe et code 2FA requis) |
| 8.2 Droits d’accès privilégiés | Page d’administration protégée par un jeton dédié stocké sous forme d’empreinte ; aucun accès au contenu des coffres |
| 8.24 Cryptographie | Algorithmes standards (AES-GCM, Argon2id, scrypt, HKDF, X25519, HMAC-SHA256) ; aucune cryptographie maison |
| 8.12 Prévention des fuites | Adresse IP complète jamais enregistrée ; statistiques d’administration uniquement agrégées |
| 8.13 Sauvegardes | {{#si backups}}Sauvegardes automatiques chiffrées vers un stockage S3, conservation {{retentionDays}} jours, procédure de restauration documentée{{/si}} |
| 8.15 Journalisation | Journal des événements de sécurité avec identifiants pseudonymisés, conservé 90 jours |
| 8.16 Surveillance | Tableau de bord des performances et de l’espace de stockage |
| 8.23 / 8.26 Sécurité des applications | En-têtes de sécurité (CSP, HSTS, X-Frame-Options, Referrer-Policy), aucune ressource tierce exécutable |
| 8.20 Sécurité des réseaux | TLS obligatoire pour les applications (HTTP accepté uniquement en local) |
| 5.34 Protection de la vie privée | Minimisation des données, droits exercés depuis l’application |
| 5.24 Gestion des incidents | Notification des violations au Client sous 72 heures |

## Organisation

- Accès administrateur limité aux personnes désignées par l’Exploitant, soumises à confidentialité.
- Mises à jour de sécurité du système et du serveur appliquées régulièrement.
- Hébergement : {{hostingProvider}} ({{hostingLocation}}).
