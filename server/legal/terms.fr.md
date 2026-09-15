# Conditions d’utilisation

Entrée en vigueur : {{effectiveDate}}

## 1. Objet

Ce service BetterVault est exploité par **{{operatorName}}**, {{operatorAddress}} (« l’Exploitant »). Il permet de conserver, synchroniser et partager des identifiants, codes de double authentification, tâches et fichiers **chiffrés sur l’appareil de l’utilisateur avant tout envoi**.

## 2. Compte

- La création d’un compte demande une adresse email et un mot de passe principal choisi par l’utilisateur.
- Le mot de passe principal n’est jamais transmis à l’Exploitant. **L’Exploitant ne peut ni le retrouver ni déchiffrer les données.** La clé de secours remise à la création du compte est le seul moyen de récupérer un coffre en cas d’oubli.
- L’utilisateur est responsable de la confidentialité de son mot de passe principal, de sa clé de secours et de ses appareils.

## 3. Utilisation acceptable

L’utilisateur s’engage à ne pas :

- stocker ou partager des contenus illicites ;
- tenter d’accéder aux comptes ou aux données d’autres utilisateurs ;
- perturber le fonctionnement du service (attaques, surcharge volontaire, contournement des limites).

L’Exploitant peut suspendre un compte en cas de manquement grave, après notification lorsque c’est possible.

## 4. Coffres partagés

Le propriétaire d’un coffre partagé choisit ses membres et leurs rôles. Tout membre peut lire le contenu du coffre ; l’utilisateur ne partage un coffre qu’avec des personnes de confiance. L’Exploitant n’intervient pas dans les relations entre membres.

## 5. Disponibilité et sauvegardes

Le service est fourni sans garantie de disponibilité continue. {{#si backups}}Des sauvegardes chiffrées sont réalisées régulièrement et conservées {{retentionDays}} jours.{{/si}} L’utilisateur est invité à conserver un export chiffré de ses données.

{{#si billing}}
## 6. Offres payantes

Des offres optionnelles augmentent l’espace et les limites du compte. Le paiement est traité par Stripe. Un abonnement peut être résilié à tout moment depuis le portail de facturation ; l’espace supplémentaire reste disponible jusqu’à la fin de la période payée. Si l’espace utilisé dépasse ensuite les limites de base, l’ajout de nouveaux éléments est bloqué, sans suppression des données existantes.
{{/si}}

## 7. Données personnelles

Le traitement des données est décrit dans la [politique de confidentialité](/legal/privacy). Pour les organisations clientes, l’[accord de traitement des données](/legal/dpa) s’applique.

## 8. Résiliation

L’utilisateur peut supprimer son compte à tout moment depuis l’application : le coffre, les coffres partagés dont il est propriétaire, les pièces jointes et les sessions sont effacés immédiatement du serveur{{#si backups}}, puis des sauvegardes au plus tard {{retentionDays}} jours après{{/si}}.

## 9. Responsabilité

Le service étant chiffré de bout en bout, l’Exploitant ne peut pas restaurer des données dont la clé est perdue. Sa responsabilité ne saurait être engagée pour une perte résultant de l’oubli du mot de passe principal et de la clé de secours.

## 10. Droit applicable

Ces conditions sont soumises au droit : {{jurisdiction}}. Contact : {{contactEmail}}.
