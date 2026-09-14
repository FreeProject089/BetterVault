# Tâches

Ouvrez **Gestionnaire de Tâches** dans la barre latérale. Les tâches appartiennent au coffre actif.

## Créer une tâche

**Nouveau** ouvre le formulaire :

| Champ | Rôle |
| --- | --- |
| Titre, description | Contenu de la tâche |
| Priorité | Basse, moyenne, haute, urgente |
| Échéance | Date limite |
| Récurrence | Quotidienne, hebdomadaire, mensuelle, annuelle, avec intervalle et date de fin |
| Rappel | Date et heure d'une notification |
| Tags | Voir [Coffres et tags](coffres-tags.md) |
| Dépend de | Tâches à terminer avant celle-ci |
| Identifiant lié | Accès direct à l'identifiant concerné |

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
