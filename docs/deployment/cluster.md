# Plusieurs serveurs (grappe)

Une grappe relie plusieurs serveurs BetterVault **de votre infrastructure** — par exemple EU-W et EU-E, ou EU-W et US-E. Chaque nœud garde une copie chiffrée des comptes de sa zone : si un nœud tombe, un autre de la même zone prend le relais, et le nœud absent rattrape tout à son retour.

## Ce que la grappe permet, et ce qu'elle interdit

| | |
| --- | --- |
| Se connecter sur EU-E avec un compte créé sur EU-W | Oui, dès la synchronisation suivante |
| Continuer si un nœud ou une région tombe | Oui, sur les autres nœuds de la zone |
| Qu'un compte européen soit copié aux États-Unis | **Non.** Un compte ne quitte pas sa zone de résidence |
| Qu'un serveur d'un autre opérateur récupère des données | **Non.** Il n'est dans aucun manifeste signé |
| Qu'un utilisateur demande à son serveur les données d'un autre | **Non.** Les routes de grappe ne répondent qu'aux nœuds signés |
| Qu'un nœud lise un coffre | **Non.** Ce qui circule est chiffré sur les appareils |

Pour déplacer un compte vers un serveur **d'un autre opérateur**, c'est l'utilisateur qui exporte et importe ses données : les serveurs ne le font jamais d'eux-mêmes.

## Confiance

Il n'y a pas de secret partagé.

- **Chaque nœud** a une paire de clés Ed25519, créée au premier démarrage. Sa clé privée ne quitte pas le nœud et y est chiffrée.
- **La grappe** a une clé racine, gardée par le nœud qui l'a créée. Elle signe un **manifeste** : la liste des nœuds autorisés, avec leur zone, leur région, leur adresse, leur clé publique et leur statut. Chaque changement produit une nouvelle époque signée.
- **Toute requête** entre nœuds est signée par la clé de son émetteur (heure, nombre unique, empreinte du corps) et n'est acceptée que d'un nœud **actif** du manifeste courant. Une requête ne se rejoue pas.

## Mise en place

Tout se fait dans `/admin`, onglet **Grappe**, par un administrateur propriétaire (les actions sensibles redemandent le mot de passe).

1. **Sur le premier nœud** : *Créer une grappe*. Donnez un nom à la grappe, au nœud (`EU-W`), sa **zone de résidence** (`EU`), sa région (`eu-west`) et son adresse publique en `https://`.
2. **Toujours sur ce nœud** : *Créer une invitation*. Le code est valable une heure et ne sert qu'une fois.
3. **Sur le nouveau nœud** : onglet Grappe, *Rejoindre une grappe*, collez le code et décrivez le nœud. Il affiche l'**empreinte de sa clé**.
4. **Sur le premier nœud** : la demande apparaît avec la même empreinte. Comparez, puis *Approuver*.

Le code d'invitation contient l'empreinte de la clé racine : le nouveau nœud refuse une racine qui ne correspond pas, même si quelqu'un s'intercale sur le réseau.

## Zones de résidence

La zone (`EU`, `US`, `CH`…) décide où vivent les données. Un compte appartient à la zone du nœud où il a été créé et n'est répliqué que vers les nœuds actifs de cette zone. Plusieurs zones peuvent partager une grappe — même opérateur, même administration — sans qu'aucune donnée ne passe de l'une à l'autre.

## Gestion des nœuds

| Action | Effet |
| --- | --- |
| Désactiver | Le nœud reste dans la grappe mais ne réplique plus. Réactivé, il rattrape tout |
| Révoquer | Le nœud est coupé immédiatement ; on peut indiquer son remplaçant |
| Retirer | Supprime un nœud révoqué du manifeste |
| Réintégrer | Un nœud révoqué rejoint à nouveau avec une nouvelle invitation, donc une nouvelle identité |
| Renouveler la clé d'un nœud | La demande est signée avec l'ancienne clé ; les autres nœuds adoptent la nouvelle |
| Renouveler la clé racine | Le nouveau manifeste est signé par l'ancienne racine, ce qui autorise le passage |
| Exporter la clé racine | Copie chiffrée par une phrase de passe (16 caractères au moins). À ranger hors ligne |
| Importer la clé racine | Sur un autre nœud membre, si le nœud racine est perdu : il devient racine et l'annonce |

Un nœud revenu après une longue absence tire d'abord le dernier manifeste auprès de la racine, puis rattrape les changements page par page. S'il a été révoqué entre-temps, il l'apprend et s'arrête.

## Écritures simultanées

Chaque compte et chaque coffre porte un vecteur de version. Si deux nœuds sont modifiés avant de s'être parlé, les deux versions sont gardées : les nœuds retiennent la même, et l'application de l'utilisateur fusionne l'autre à sa synchronisation suivante, élément par élément et champ par champ. Rien n'est écrasé en silence.

## Supervision

L'onglet Grappe montre, par zone, chaque nœud avec sa santé (synchronisé, hors ligne, en erreur, désactivé, révoqué), son retard, sa dernière synchronisation réussie et sa dernière erreur, ainsi que les demandes d'adhésion et le journal des événements. Le tableau de bord signale ce qui demande une intervention.

## Réseau

- HTTPS obligatoire entre nœuds, sauf `localhost` pour des essais.
- Horloges à l'heure (NTP) : une requête signée n'est acceptée que dans une fenêtre de cinq minutes.
- Chaque nœud garde sa propre `PUBLIC_URL`, pour les liens des emails.
