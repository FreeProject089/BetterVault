# Documents légaux et RGPD

Le serveur publie cinq documents sur `/legal` :

| Adresse | Document |
| --- | --- |
| `/legal/terms` | Conditions d'utilisation |
| `/legal/privacy` | Politique de confidentialité |
| `/legal/dpa` | Accord de traitement des données (article 28 du RGPD) |
| `/legal/security` | Mesures de sécurité |
| `/legal/subprocessors` | Sous-traitants |

Ce sont des **modèles**. Ils décrivent le fonctionnement réel du logiciel (chiffrement de bout en bout, durées de conservation, sauvegardes) et se complètent avec votre identité d'hébergeur.

Chaque serveur gère sa propre partie légale : rien n'est publié par BetterVault lui-même, et un serveur peut n'en publier aucun.

## Ne rien publier

`LEGAL_ENABLED=false`, ou la case **Publier des documents légaux sur ce serveur** décochée dans `/admin`, retire la section entière :

- `/legal` et `/legal/<document>` répondent **404** ;
- `GET /api/v1/legal` renvoie `{"enabled": false, "documents": []}` ;
- l'application n'affiche plus la case d'acceptation à la création d'un compte, ni la liste des documents dans **Compte › Données** ;
- la liste de contrôle du tableau de bord ne réclame plus de compléter l'identité de l'hébergeur.

C'est le réglage d'un **serveur personnel**, où vous êtes le seul utilisateur : il n'y a personne à informer. Dès que d'autres personnes y ouvrent un compte, la situation change — vous devenez leur hébergeur, et les informer vous revient. Le réglage est donc activé par défaut.

## Compléter

Dans `/admin`, onglet **Documents légaux** : nom ou raison sociale, adresse, email de contact, délégué à la protection des données, hébergeur et pays des serveurs, autorité de contrôle, droit applicable, date d'entrée en vigueur. Les mêmes valeurs peuvent venir du `.env` (`LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`…).

Tant que le nom et l'email de contact sont vides, les documents restent lisibles mais signalent qu'ils ne sont pas complétés.

Les textes s'adaptent au serveur : les sauvegardes, les emails, les offres payantes et la localisation des sessions n'apparaissent que si vous les avez activés.

!!! warning "Relisez-les"
    Ces modèles ne sont pas un avis juridique. En tant qu'hébergeur, vous êtes responsable du contenu publié et de sa conformité à votre situation.

## Lien à la création d'un compte

Dans les applications, la création d'un compte synchronisé demande d'accepter les conditions d'utilisation et la politique de confidentialité **du serveur choisi** ; les liens pointent vers `/legal` de ce serveur. Les documents sont aussi accessibles depuis **Compte › Données**.

L'application interroge `GET /api/v1/legal` sur l'adresse saisie avant d'afficher quoi que ce soit : un serveur qui ne publie rien ne fait apparaître aucune case à cocher. Si le serveur ne répond pas, la case reste affichée — mieux vaut une acceptation superflue qu'une acceptation escamotée.

## Droits des personnes

| Droit | Comment |
| --- | --- |
| Accès et portabilité | Export depuis l'application (JSON, CSV, KeePass, export chiffré) |
| Rectification | Modification directe dans l'application |
| Effacement | **Compte › Supprimer le compte en ligne** : coffres, pièces jointes, sessions et abonnement supprimés immédiatement |
| Limitation et opposition | Contact de l'hébergeur indiqué dans les documents |

Les copies présentes dans les sauvegardes disparaissent au terme de la durée de conservation configurée (`BACKUP_RETENTION_DAYS`, 30 jours par défaut). Le journal de sécurité est conservé 90 jours avec des comptes pseudonymisés.
