# Tâches

Ouvrez **Tâches** dans la barre latérale. Les tâches appartiennent au coffre actif.

## Créer une tâche

**Nouveau** ouvre le formulaire :

| Champ | Rôle |
| --- | --- |
| Titre, description | Contenu de la tâche |
| Priorité | Basse, moyenne, haute, urgente |
| Échéance | Date limite |
| Attribuée à | Un membre du coffre, dans un [coffre partagé](partage.md) |
| Récurrence | Quotidienne, hebdomadaire, mensuelle, annuelle, avec intervalle et date de fin |
| Rappel | Date et heure d'une notification |
| Tags | Voir [Coffres et tags](coffres-tags.md) |
| Dépend de | Tâches à terminer avant celle-ci |
| Identifiant lié | Accès direct à l'identifiant concerné |

## Attribuer une tâche

Dans un coffre partagé, le champ **Attribuée à** propose les membres du coffre. L'attribution voyage avec la tâche, chiffrée comme le reste : chaque membre voit qui s'en occupe.

- La pastille colorée de la personne apparaît dans la liste et sur les cartes ; sa couleur est calculée depuis son adresse, donc la même partout sans rien synchroniser.
- Une bande de filtres s'ajoute au-dessus de la liste : **Toutes**, **Les miennes**, **Non attribuées**, puis une pastille par personne, avec le compte.
- Si la personne quitte le coffre, son nom reste sur la tâche plutôt que de disparaître en silence : vous choisissez la suite.
- Hors ligne, la liste des membres n'est pas joignable ; le champ reste utilisable avec votre adresse et l'attribution en cours, et le dit.

Dans un coffre personnel, le champ n'apparaît pas : il n'y a personne d'autre.

## Vues

- **Liste** : tâches ouvertes triées par priorité, puis tâches terminées.
- **Kanban** : colonnes À faire, En cours, Bloquée, Terminée.
- **Matrice d'Eisenhower** : répartition automatique des tâches ouvertes.
- **Calendrier** : en retard, aujourd'hui, à venir, sans échéance.

### Matrice d'Eisenhower

| | Urgent | Non urgent |
| --- | --- | --- |
| **Important** (priorité haute ou urgente) | Faire maintenant | Planifier |
| **Moins important** | Déléguer | Plus tard |

Une tâche est urgente si sa priorité est « urgente » ou si son échéance est dans 2 jours ou moins.

## Sous-tâches

Dans la fiche d'une tâche, ajoutez des étapes et cochez-les au fur et à mesure.

## Dépendances

- Une tâche avec des prérequis ouverts passe au statut **Bloquée**.
- Elle ne peut pas être terminée tant que ses prérequis ne le sont pas.
- Terminer le dernier prérequis la débloque automatiquement.
- Les dépendances circulaires sont refusées.

## Récurrences

Terminer une tâche récurrente crée la prochaine occurrence avec :

- la nouvelle échéance (le 31 janvier devient le 28 ou 29 février)
- les sous-tâches décochées
- le rappel décalé d'autant

Aucune occurrence n'est créée après la date de fin.

## Rappels

À l'heure choisie, BetterVault affiche un message et, si vous l'avez autorisé, une notification système. Les rappels ne sont affichés que lorsque le coffre est déverrouillé.
