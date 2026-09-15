# Accord de traitement des données (DPA)

Conforme à l’article 28 du Règlement (UE) 2016/679 (RGPD). Entrée en vigueur : {{effectiveDate}}

## 1. Parties

- **Le Responsable du traitement** : l’organisation cliente qui utilise le service pour ses membres (« le Client »).
- **Le Sous-traitant** : {{operatorName}}, {{operatorAddress}}, contact {{contactEmail}} (« l’Exploitant »).

Cet accord complète les [conditions d’utilisation](/legal/terms) et prévaut sur elles pour tout ce qui concerne les données personnelles.

## 2. Objet et durée

L’Exploitant héberge et synchronise les coffres chiffrés du Client pour la durée d’utilisation du service.

## 3. Nature et finalités du traitement

| Élément | Description |
| --- | --- |
| Nature | Stockage, synchronisation, partage et sauvegarde de données chiffrées de bout en bout |
| Finalité | Fournir le gestionnaire de mots de passe et de tâches BetterVault |
| Catégories de personnes | Membres, salariés et prestataires du Client disposant d’un compte |
| Catégories de données | Email, métadonnées de session (IP tronquée{{#si geo}}, lieu approximatif{{/si}}, appareil), contenu chiffré illisible par l’Exploitant |
| Données sensibles | Aucune accessible à l’Exploitant : tout contenu est chiffré avec des clés qu’il ne détient pas |

## 4. Obligations de l’Exploitant

L’Exploitant :

1. ne traite les données que sur instruction documentée du Client, ces conditions constituant ses instructions ;
2. garantit que les personnes autorisées à administrer le serveur sont soumises à une obligation de confidentialité ;
3. met en œuvre les mesures de sécurité de l’annexe ([Mesures de sécurité](/legal/security)) ;
4. ne recourt à un autre sous-traitant qu’avec l’information préalable du Client, qui peut s’y opposer ([liste actuelle](/legal/subprocessors)) ;
5. aide le Client à répondre aux demandes d’exercice des droits, notamment par les fonctions d’export et de suppression de compte ;
6. aide le Client à garantir la sécurité, à notifier les violations et à réaliser une analyse d’impact si nécessaire ;
7. notifie au Client toute violation de données personnelles **dans un délai de 72 heures** après en avoir pris connaissance, avec les informations disponibles ;
8. supprime les données à la fin du service : immédiatement sur le serveur{{#si backups}}, et dans les sauvegardes au plus tard {{retentionDays}} jours plus tard{{/si}} ; le Client peut exporter ses données avant ;
9. met à disposition les informations nécessaires pour démontrer le respect de l’article 28 et permet des audits raisonnables, sur préavis de 30 jours.

## 5. Chiffrement de bout en bout

Le Client reconnaît que l’Exploitant ne peut pas accéder au contenu des coffres. En conséquence, l’Exploitant ne peut ni rechercher, ni rectifier, ni restituer en clair des données dont le Client a perdu les clés.

## 6. Transferts hors de l’Union européenne

Les données sont hébergées : {{hostingLocation}}. Tout transfert hors de l’Espace économique européen est encadré par les clauses contractuelles types de la Commission européenne ou une décision d’adéquation.

## 7. Responsabilité et durée

Cet accord reste en vigueur tant que l’Exploitant traite des données pour le Client. Il est régi par le droit : {{jurisdiction}}.

---

**Annexe 1** : [Mesures de sécurité](/legal/security)
**Annexe 2** : [Sous-traitants](/legal/subprocessors)
