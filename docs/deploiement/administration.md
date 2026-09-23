# Page d'administration

La page `/admin` pilote le serveur : réglages, sauvegardes, grappe, emails, documents légaux et comptes d'administration. Elle ne donne jamais accès au contenu des coffres : le serveur ne le connaît pas.

## Se connecter

Deux façons d'entrer :

| Méthode | Quand l'utiliser |
| --- | --- |
| **Compte administrateur** (email + mot de passe, puis code 2FA s'il est activé) | L'usage normal, une personne par compte |
| **Jeton de secours** `ADMIN_TOKEN` | Créer le premier compte propriétaire, ou dépanner si plus personne ne peut se connecter |

Le jeton est affiché dans les journaux au premier démarrage, ou fixé dans le `.env`. Une fois un propriétaire créé, désactivez-le :

```bash
ADMIN_TOKEN=disabled
```

Tant qu'il reste actif alors que des comptes existent, l'onglet **Administrateurs** l'affiche en avertissement.

## Rôles

| Rôle | Peut |
| --- | --- |
| Lecteur | Consulter le tableau de bord, le journal et les réglages |
| Opérateur | En plus : lancer synchronisations, sauvegardes et tests (SMTP, S3) |
| Propriétaire | Tout, dont les réglages, les nœuds de la grappe, les secrets et les restaurations |

Les actions sensibles (restaurer une sauvegarde, retirer un nœud, changer un secret) demandent de ressaisir son mot de passe, et le code 2FA s'il est activé.

## Les écrans

| Groupe | Écran | Rôle |
| --- | --- | --- |
| Aperçu | Tableau de bord | Activité, stockage, performances, contrôles de sécurité — voir [Supervision](supervision.md) |
| | Journal | Événements sensibles, comptes pseudonymisés |
| Configuration | Réglages | Adresse publique, inscriptions, pièces jointes, page d'accueil, annuaire, SMTP, thème par défaut |
| | Offres | Espace payant — voir [Stripe](offres-stripe.md) |
| | Documents légaux | Informations de l'hébergeur — voir [Documents légaux](documents-legaux.md) |
| | Emails | Aperçu et personnalisation des messages — voir [Emails et langues](emails-langues.md) |
| | Langues | Packs de traduction |
| Infrastructure | Sauvegardes | Destinations S3, historique, restauration — voir [Sauvegardes](sauvegardes.md) |
| | Grappe | Nœuds et réplication — voir [Grappe](grappe.md) |
| Accès | Administrateurs | Comptes d'administration, son propre mot de passe et sa 2FA |

## Thème

Par défaut, l'administration **reprend le thème de l'application** ouverte dans le même navigateur : mode clair ou sombre, et couleurs d'un thème personnalisé. Si l'application change de thème dans un autre onglet, l'administration suit.

Le bouton de l'en-tête fait défiler quatre choix, retenus sur l'appareil :

| Icône | Choix |
| --- | --- |
| ◈ | Celui de l'application |
| ◐ | Celui du système |
| ☀ | Clair |
| ☾ | Sombre |

Le choix par défaut, pour les appareils qui n'en ont pas fait, se règle dans **Réglages → Page publique et annuaire → Thème de l'administration par défaut**.

## Limites de tentatives

Le serveur compte les tentatives par adresse IP et par action. L'usage normal ne les atteint pas ; deviner un mot de passe ou un jeton, si.

| Action | Limite |
| --- | --- |
| Préparation de connexion | 60 par minute |
| Connexion à un compte | 10 par minute |
| Inscription | 10 par heure |
| Changement de mot de passe | 10 par minute |
| Récupération de compte | 10 par quart d'heure |
| Suppression de compte | 5 par heure |
| Appels de l'administration | 600 par minute |
| Jetons ou identifiants d'administration **faux** | 10 par quart d'heure |

Seuls les échecs comptent pour l'administration : naviguer entre les écrans ne bloque jamais. Après dix échecs, même le bon jeton est refusé jusqu'à la fin du délai.

Une requête bloquée reçoit le statut `429`, l'en-tête `Retry-After` (en secondes) et un message qui donne l'attente exacte : « Trop de tentatives, réessayez dans 12 min ».

!!! tip "Derrière un proxy"
    Sans `TRUST_PROXY=true`, toutes les requêtes semblent venir du proxy et partagent le même compteur. Activez-le dès que le serveur est derrière Caddy, Nginx ou Traefik — voir [Configuration](configuration.md).
