# Changer de compte ou de serveur

La **grappe** réplique automatiquement vos données entre les serveurs d'un même opérateur. Pour partir ailleurs (un autre compte, ou un serveur tenu par quelqu'un d'autre), c'est vous qui déplacez vos données avec une **sauvegarde complète**.

## Exporter

1. **Importer / Exporter**, onglet **Exporter**.
2. **Tout le compte, fichiers compris**, puis choisissez un mot de passe (10 caractères minimum).
3. Un fichier `bettervault-complet-<date>.encrypted.json` est enregistré.

Il contient tous vos coffres, identifiants, tâches, étiquettes et pièces jointes. Les fichiers restent chiffrés avec leur propre clé, et le tout est chiffré une seconde fois par ce mot de passe (Argon2id et AES-256-GCM).

Un coffre partagé n'est inclus que si votre rôle permet l'export. Il devient un coffre ordinaire, car ses membres n'existent pas sur l'autre serveur.

## Importer

1. Connectez-vous au compte de destination.
2. **Importer / Exporter**, onglet **Importer**, **Autre fichier**, puis déposez le fichier et saisissez son mot de passe.
3. Avant tout changement, un bilan vérifie ce que ce compte peut recevoir :
    - si le serveur accepte les fichiers, et leur taille maximale ;
    - la place restante ;
    - le nombre de coffres autorisés ;
    - la taille maximale du coffre.

Tout est **ajouté** à côté de ce que contient déjà le compte : rien n'est remplacé. Les coffres de même nom reçoivent le suffixe « (importé) ».

## Quand tout ne tient pas

Le bilan explique ce qui bloque :

| Cas | Ce qui se passe | Solutions |
| --- | --- | --- |
| Le serveur ne garde pas de fichiers | Les petits fichiers voyagent dans le coffre chiffré, les autres restent dans la sauvegarde | Un serveur qui accepte les fichiers, ou votre propre serveur |
| Fichier trop gros | Il reste dans la sauvegarde | Une offre supérieure, un autre serveur |
| Plus de place | Les plus petits fichiers passent d'abord ; le bilan indique la place requise et disponible | Libérer de la place, une offre supérieure |
| Trop de coffres | Les derniers coffres ne sont pas créés | Une offre supérieure, fusionner des coffres avant l'export |
| Coffre trop volumineux | L'import est refusé | Une offre supérieure, vider la corbeille, un compte vide |

Vous pouvez importer sans ce qui dépasse : rien n'est perdu, tout reste dans le fichier de sauvegarde.

Les gros fichiers partent par morceaux de 4 Mo. Si la connexion coupe, l'envoi reprend là où le serveur s'est arrêté, sans tout renvoyer. Si l'import échoue quand même, le coffre n'est pas modifié, les fichiers déjà envoyés sont retirés du serveur, et vous pouvez relancer l'import.
