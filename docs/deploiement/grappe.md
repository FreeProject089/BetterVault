# Plusieurs serveurs (grappe)

Une grappe relie plusieurs serveurs BetterVault **tenus par le même opérateur** — par exemple un nœud en Europe et un aux États-Unis. Chaque nœud recopie les comptes, coffres, coffres partagés et fichiers des autres : on se connecte à n'importe lequel avec son mot de passe principal et l'on y retrouve tout.

## Ce que la grappe permet, et ce qu'elle ne permet pas

| | |
| --- | --- |
| Se connecter sur `us` avec un compte créé sur `eu` | Oui, après la synchronisation suivante |
| Continuer si un nœud est en panne | Oui : les autres ont une copie |
| Qu'un serveur tenu par quelqu'un d'autre récupère des données | **Non.** Il ne possède pas le secret de la grappe |
| Qu'un utilisateur demande à son serveur les données d'un autre serveur | **Non.** Les routes de grappe ne répondent qu'aux nœuds signés |
| Qu'un nœud lise un coffre | **Non.** Ce qui circule est chiffré sur les appareils |

Pour passer d'un serveur à un autre **tenu par quelqu'un d'autre**, on passe par l'export complet puis l'import (voir [Changer de serveur](../guide/changer-de-serveur.md)) : c'est l'utilisateur qui déplace ses données, pas les serveurs.

## Mise en place

Sur **chaque** nœud :

```bash
CLUSTER_NODE_ID=eu                          # nom de ce nœud
CLUSTER_SECRET=...                          # identique partout
CLUSTER_PEERS=us=https://us.exemple.fr      # les AUTRES nœuds
```

Pour générer le secret :

```bash
openssl rand -base64 48
```

- `CLUSTER_NODE_ID` : lettres minuscules, chiffres et tirets.
- `CLUSTER_PEERS` : liste `id=adresse` séparée par des virgules. HTTPS obligatoire, sauf `localhost` pour des essais.
- `CLUSTER_SYNC_INTERVAL_S` : fréquence de synchronisation, 30 secondes par défaut.
- `PUBLIC_URL` propre à chaque nœud : les liens des emails pointent vers le nœud qui les envoie.

Les horloges doivent être à l'heure (NTP) : une requête signée n'est acceptée que dans une fenêtre de cinq minutes.

## Fonctionnement

**Confiance.** Chaque requête entre nœuds porte une signature HMAC du secret, l'identité du nœud, l'heure et un nombre unique. Un nœud non déclaré dans `CLUSTER_PEERS` est refusé même s'il connaît le secret ; une requête ne peut pas être rejouée.

**Réplication.** Chaque nœud tire des autres la liste de ce qui a changé, par pages, puis l'état complet de chaque compte ou coffre partagé concerné, puis les fichiers manquants par tranches de 4 Mo. Un changement est repéré par la base elle-même (déclencheurs SQL) : aucune route n'est oubliée.

**Écritures simultanées.** Chaque compte et chaque coffre porte un vecteur de version. Si un appareil écrit sur `eu` pendant qu'un autre écrit sur `us`, les deux versions sont concurrentes : les nœuds retiennent la même, et gardent l'autre de côté. Au prochain passage, l'application fusionne cette version mise de côté puis l'acquitte. Rien n'est perdu.

**Suppressions.** Supprimer un compte, un coffre partagé ou un fichier laisse une trace répliquée ; la suppression l'emporte toujours.

**Ce qui reste propre à chaque nœud.** Sessions, codes email, jetons de récupération et liens « ce n'était pas moi ». On se reconnecte en changeant de nœud.

**Inscription.** Avant de créer un compte, le nœud demande aux autres si l'adresse est déjà prise — sous forme d'empreinte, l'adresse ne circule pas en clair. Un nœud injoignable ne bloque pas l'inscription ; si deux comptes de même adresse naissent quand même sur deux nœuds coupés l'un de l'autre, aucun n'écrase l'autre et le tableau de bord le signale.

## Données personnelles

Répliquer, c'est copier : un compte créé en Europe existe aussi sur le nœud américain. Le contenu des coffres reste illisible pour les serveurs, mais l'adresse email et les métadonnées de compte sont bien copiées. Si l'objectif d'un nœud par région est de **garder** les données dans une région, une grappe ne convient pas : il faut alors deux serveurs indépendants, et chaque utilisateur choisit le sien.

## Supervision

Le tableau de bord d'administration montre, pour chaque nœud : dernière synchronisation réussie, retard, dernière erreur, et le nombre de versions concurrentes en attente de fusion. Le bouton **Synchroniser** lance un passage immédiat.
