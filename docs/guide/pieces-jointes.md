# Pièces jointes

Ajoutez des fichiers à un identifiant : contrat, facture, photo d'un document, fichier de clés… Il faut un compte synchronisé.

- Fiche de l'identifiant > **Pièces jointes** > **Ajouter un fichier**.
- Chaque fichier est chiffré sur l'appareil avec sa propre clé AES-256-GCM avant l'envoi. Cette clé est rangée dans le coffre chiffré : le serveur ne stocke que des octets illisibles.
- **Télécharger** déchiffre le fichier sur l'appareil. **Supprimer** l'efface du serveur.
- Supprimer un identifiant supprime aussi ses pièces jointes.

Dans un coffre partagé, les membres dont le rôle inclut **Pièces jointes** peuvent en ajouter et en supprimer ; tous les membres peuvent les télécharger.

## Limites

| Limite | Défaut | Réglage |
| --- | --- | --- |
| Taille d'un fichier | 25 Mo | `LIMIT_MAX_ATTACHMENT_MB` ou `/admin` |
| Espace par compte | 500 Mo | `LIMIT_ATTACHMENT_QUOTA_MB` ou `/admin` |

Les fichiers des coffres partagés comptent dans l'espace de leur propriétaire.
