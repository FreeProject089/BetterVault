# Coffres partagés

Un coffre partagé est accessible à plusieurs comptes du même serveur BetterVault. Il faut un compte synchronisé.

## Créer ou partager un coffre

- **Nouveau coffre** : cochez **Coffre partagé** dans la fenêtre de création.
- **Coffre existant** : ouvrez ses réglages (crayon à côté du nom) puis **Transformer en coffre partagé**. Son contenu est déplacé dans le coffre partagé.

Vous en devenez propriétaire.

## Inviter un membre

1. Réglages du coffre > onglet **Membres**.
2. Saisissez l'email du compte BetterVault puis **Rechercher**.
3. Comparez l'**empreinte de clé** affichée avec celle que voit la personne (appel, message) : si elles sont identiques, personne n'a intercalé une autre clé.
4. Choisissez un rôle puis **Inviter**.

La personne voit l'invitation dans la barre latérale et l'accepte ou la refuse. Si le serveur envoie des emails, elle est aussi prévenue par email.

## Rôles et permissions

| Rôle | Ajouter et modifier | Pièces jointes | Exporter | Gérer les membres | Gérer les rôles | Supprimer le coffre |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Propriétaire | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Administrateur | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Éditeur | ✓ | ✓ | ✓ | | | |
| Lecteur | | | | | | |

Dans l'onglet **Rôles**, un membre qui peut gérer les rôles crée des rôles personnalisés en cochant leurs permissions. Seul le propriétaire peut supprimer le coffre.

!!! note "Ce que le serveur garantit"
    Le serveur refuse les modifications, invitations et suppressions non autorisées. En revanche, **tout membre peut lire le contenu** : il reçoit la clé du coffre. Ne partagez un coffre qu'avec des personnes qui peuvent en voir tous les éléments.

## Retirer un membre, quitter, transférer

- **Retirer** : le coffre est rechiffré avec une nouvelle clé remise uniquement aux membres restants. L'ancien membre ne peut plus lire les modifications suivantes (ce qu'il a déjà vu a pu être copié).
- **Transférer la propriété** : choisissez **Propriétaire** comme rôle d'un membre actif. Vous devenez administrateur.
- **Quitter** : réglages du coffre > **Quitter**. Le propriétaire doit d'abord transférer la propriété ou supprimer le coffre.

## Comment c'est chiffré

- Chaque compte possède une paire de clés X25519. La clé privée est chiffrée par la clé du coffre personnel : le serveur ne peut pas l'utiliser.
- La clé d'un coffre partagé est scellée pour chaque membre (X25519 éphémère, HKDF, AES-256-GCM).
- Le contenu du coffre partagé est chiffré en AES-256-GCM, comme le coffre personnel.
