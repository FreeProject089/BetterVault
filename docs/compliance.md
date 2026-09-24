# Zero-knowledge, zero-trust et conformité

## Zero-knowledge

Le serveur ne peut pas lire ce qu'il stocke. Le chiffrement et le déchiffrement ont lieu uniquement sur les appareils, avec des clés dérivées du mot de passe principal, qui n'est jamais envoyé.

| Le serveur voit | Le serveur ne voit pas |
| --- | --- |
| Adresse email, paramètres Argon2id et sel | Mot de passe principal, clé du coffre |
| Coffre chiffré, taille et numéro de révision | Identifiants, notes, codes 2FA, tâches |
| Pièces jointes chiffrées et leur taille | Nom et contenu des fichiers |
| Coffres partagés chiffrés, membres et rôles | Contenu partagé (clé scellée pour chaque membre en X25519) |
| Empreinte SHA-256 des jetons de session, IP tronquée | Jeton de session en clair, adresse IP complète |

Les pièces jointes sont chiffrées avec une clé par fichier, rangée dans le coffre : le serveur ne stocke que des octets illisibles. Le partage d'un coffre scelle la clé pour chaque membre ; retirer un membre déclenche une rotation de clé.

## Zero-trust

Le serveur n'accorde aucune confiance implicite, ni au réseau, ni à l'appareil, ni à l'administrateur.

- **Chaque requête est authentifiée** : jeton de session vérifié, comparaison en temps constant, expiration et révocation immédiates.
- **Les opérations sensibles redemandent une preuve** : la preuve dérivée du mot de passe principal, plus un code d'application d'authentification s'il est activé — changement de mot de passe, suppression de compte, fermeture d'une session, désactivation de la 2FA.
- **Les droits sont vérifiés côté serveur** : rôles et permissions des coffres partagés à chaque appel, jamais sur la seule foi de l'application cliente.
- **L'administrateur du serveur n'est pas un lecteur privilégié** : la page `/admin` règle le serveur et montre des totaux, sans aucun accès aux contenus. Une copie de la base ne révèle rien sans les mots de passe des utilisateurs.
- **Écritures conditionnées au numéro de révision** : pas d'écrasement silencieux entre appareils.
- **Limitation des tentatives** par adresse, et réponses identiques pour un email inconnu (pas d'énumération des comptes).

## Alignement ISO/IEC 27001

BetterVault n'est **pas certifié** ISO/IEC 27001 : une certification porte sur l'organisation qui exploite le service, pas sur un logiciel. Le tableau ci-dessous indique ce que le logiciel fournit à un hébergeur qui vise cette norme, en reprenant l'annexe A (2022).

| Mesure (annexe A) | Ce que fournit BetterVault |
| --- | --- |
| A.5.15 Contrôle d'accès | Rôles et permissions des coffres partagés, vérifiés côté serveur |
| A.5.16 Gestion des identités | Un compte par email, pseudonymisation dans le journal |
| A.5.17 Informations d'authentification | Argon2id, vérificateur scrypt, jetons stockés en empreinte |
| A.5.18 Droits d'accès | Invitation, changement de rôle, retrait avec rotation de clé |
| A.5.28 Preuves | Journal de sécurité horodaté, conservé 90 jours |
| A.5.30 Continuité | Sauvegardes S3 planifiées, copie chiffrée téléchargeable, restauration documentée |
| A.5.34 Vie privée | Minimisation (IP tronquée, pas de télémétrie), export et suppression par la personne |
| A.8.5 Authentification sécurisée | Double authentification TOTP, clé de secours, déverrouillage biométrique |
| A.8.9 Gestion des configurations | `.env` et page `/admin`, valeurs par défaut sûres, en-têtes de sécurité |
| A.8.10 Suppression | Suppression immédiate du compte et purge des sauvegardes à l'échéance |
| A.8.12 Fuites de données | Chiffrement de bout en bout : une copie du stockage ne révèle pas les contenus |
| A.8.13 Sauvegardes | Compression, chiffrement AES-256-GCM, durée de conservation configurable |
| A.8.16 Surveillance | Tableau de bord (charge, latences, erreurs), contrôles de sécurité |
| A.8.24 Cryptographie | Argon2id, AES-256-GCM, HKDF-SHA-256, X25519, scrypt — primitives standard |
| A.8.28 Codage sécurisé | Aucune dépendance côté serveur, CSP stricte, tests automatisés |

Restent à la charge de l'hébergeur : politique de sécurité, gestion des risques, sensibilisation, sécurité physique, gestion des fournisseurs, revue de direction et audits.

## Vérifier par soi-même

- Le code est ouvert : les échanges réseau peuvent être observés avec les outils de développement du navigateur.
- `GET /api/v1/vault` renvoie un blob chiffré ; aucune route ne renvoie de contenu en clair.
- Un export de la base (onglet Tableau de bord) montre ce que contient réellement le stockage.

Voir aussi [Sécurité](security.md) pour le détail des clés et des formats.
