# Pièces jointes

Ajoutez des fichiers à n'importe quel élément : contrat, facture, photo d'un document, fichier de clés… Les types **Fichier** et **Dossier de fichiers** en font même leur contenu principal.

- Fiche de l'élément > **Pièces jointes** > **Ajouter un fichier**.
- Chaque fichier est chiffré sur l'appareil avec sa propre clé AES-256-GCM. Cette clé est rangée dans le coffre chiffré.
- **Télécharger** déchiffre le fichier sur l'appareil.
- Supprimer un élément supprime aussi ses pièces jointes.

## Où le fichier est rangé

Cela dépend du coffre, et l'application le dit sous le bouton d'ajout.

| Coffre | Où va le fichier | Taille d'un fichier |
| --- | --- | --- |
| **Synchronisé** | Sur votre serveur, qui n'en voit que des octets illisibles | 25 Mo par défaut |
| **Sur cet appareil** | Dans le coffre lui-même | 1 Mo |

Un fichier gardé dans le coffre le suit partout où le coffre va : il n'y a pas de stockage séparé à sauvegarder ni à perdre. En contrepartie il est déchiffré en mémoire avec tout le coffre à chaque ouverture, d'où une limite bien plus basse — et un plafond global correspondant à la moitié de la taille maximale du coffre.

!!! tip "Besoin de fichiers plus gros"
    Activez la synchronisation : les fichiers partent alors sur votre serveur et la limite passe à celle qu'il annonce.

Dans un coffre partagé, les membres dont le rôle inclut **Pièces jointes** peuvent en ajouter et en supprimer ; tous les membres peuvent les télécharger.

## Limites

| Limite | Défaut | Réglage |
| --- | --- | --- |
| Taille d'un fichier | 25 Mo | `LIMIT_MAX_ATTACHMENT_MB` ou `/admin` |
| Espace par compte | 500 Mo | `LIMIT_ATTACHMENT_QUOTA_MB` ou `/admin` |

Les fichiers des coffres partagés comptent dans l'espace de leur propriétaire.
