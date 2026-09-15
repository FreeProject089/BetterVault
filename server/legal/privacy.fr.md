# Politique de confidentialité

Entrée en vigueur : {{effectiveDate}}

## Responsable du traitement

**{{operatorName}}**, {{operatorAddress}}. Contact : {{contactEmail}}.{{#si dpo}} Délégué à la protection des données : {{dpoContact}}.{{/si}}

Lorsqu’une organisation utilise ce service pour ses membres, elle est responsable du traitement et l’Exploitant agit comme sous-traitant selon l’[accord de traitement des données](/legal/dpa).

## Principe : chiffrement de bout en bout

Les identifiants, codes 2FA, notes, tâches, coffres partagés et pièces jointes sont chiffrés **sur l’appareil** (AES-256-GCM, clés dérivées du mot de passe principal par Argon2id). Le serveur ne reçoit ni le mot de passe principal, ni les clés, ni les données en clair : **l’Exploitant ne peut pas les lire**.

## Données traitées par le serveur

| Donnée | Finalité | Base légale | Conservation |
| --- | --- | --- | --- |
| Adresse email | Identification du compte, emails de sécurité | Exécution du contrat | Durée du compte |
| Preuves d’authentification (dérivées, protégées par scrypt) | Connexion | Exécution du contrat | Durée du compte |
| Coffres et pièces jointes chiffrés | Synchronisation et partage | Exécution du contrat | Durée du compte |
| Clé publique de partage | Partage de coffres | Exécution du contrat | Durée du compte |
| Sessions : appareil, adresse IP tronquée{{#si geo}}, pays et ville approximatifs{{/si}}, dates | Sécurité du compte, gestion des sessions | Intérêt légitime (sécurité) | {{sessionDays}} jours maximum |
| Secret de double authentification | Vérification du code | Exécution du contrat | Jusqu’à sa désactivation |
| Journal de sécurité (type d’événement, identifiant pseudonymisé) | Détection d’abus, preuve des mesures de sécurité | Intérêt légitime | 90 jours |
{{#si billing}}| Abonnement : offre, statut, identifiants client Stripe | Facturation | Exécution du contrat, obligations comptables | Durée de l’abonnement puis obligations légales |{{/si}}

L’adresse IP complète n’est **jamais enregistrée** : elle sert uniquement, en mémoire, à limiter les tentatives de connexion{{#si geo}} et à déterminer un lieu approximatif à l’aide d’une base installée sur le serveur (aucune IP n’est envoyée à un tiers){{/si}}.

Aucun cookie publicitaire ni outil de mesure d’audience n’est utilisé. Les statistiques d’administration sont uniquement des totaux anonymes (nombre de comptes, espace utilisé, performances).

{{#si emails}}
## Emails

Le serveur envoie uniquement des emails liés à la sécurité : code de réinitialisation, alerte de nouvelle connexion, changement de mot de passe, double authentification, invitation dans un coffre partagé.
{{/si}}

## Destinataires

- L’hébergeur de l’infrastructure : {{hostingProvider}} ({{hostingLocation}}), qui ne reçoit que des données chiffrées ;
{{#si billing}}- Stripe Payments Europe, pour le paiement des offres (Stripe ne reçoit pas le contenu des coffres) ;{{/si}}
- la liste complète figure sur la page [Sous-traitants](/legal/subprocessors).

## Sauvegardes

{{#si backups}}Des copies chiffrées de la base sont conservées {{retentionDays}} jours. Une donnée supprimée disparaît des sauvegardes au plus tard à la fin de cette durée.{{/si}}

## Vos droits

Vous disposez des droits d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité.

- **Accès et portabilité** : exportez vos données depuis l’application (Importer / exporter).
- **Effacement** : supprimez votre compte depuis l’application, ou écrivez à {{contactEmail}}.
- **Sessions** : consultez et fermez les sessions actives depuis la fenêtre Compte.

Vous pouvez introduire une réclamation auprès de l’autorité de contrôle : {{supervisoryAuthority}}.

## Sécurité

Les mesures techniques et organisationnelles sont décrites sur la page [Mesures de sécurité](/legal/security).
