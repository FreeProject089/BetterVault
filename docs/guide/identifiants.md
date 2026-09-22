# Identifiants et 2FA

## Types d'éléments

Le bouton **Nouveau** demande d'abord **ce que vous voulez ranger**, puis n'affiche que les champs de ce type.

| Type | Pour quoi |
| --- | --- |
| **Identifiant** | Un site ou une application : identifiant, mot de passe, 2FA |
| **Note sécurisée** | Du texte libre : codes de secours, procédure, combinaison |
| **Carte bancaire** | Numéro, titulaire, date d'expiration, cryptogramme, code |
| **Identité** | État civil, coordonnées, numéro de pièce d'identité |
| **Clé SSH** | Clé privée, clé publique, phrase de passe |
| **Fichier** | Un document chiffré, gardé tel quel |
| **Dossier de fichiers** | Plusieurs fichiers réunis dans un même élément |

Tous les types partagent le nom, l'icône, les notes, les tags, les champs personnalisés et les pièces jointes. Seul l'identifiant a une étape **2FA**.

Les champs sensibles — numéro de carte, cryptogramme, code, numéro de pièce, clé privée — sont **masqués** dans la fiche jusqu'à ce que vous demandiez à les voir, et leur copie s'efface du presse-papiers comme un mot de passe.

!!! note "Changer le type d'un élément"
    Modifier un élément permet de changer son type. Les champs de l'ancien type ne sont pas conservés : une carte transformée en note perd son numéro.

Les types **Fichier** et **Dossier de fichiers** rangent leur contenu en [pièces jointes](pieces-jointes.md), qui fonctionnent aussi bien sur un coffre synchronisé que sur un coffre gardé sur l'appareil — seule la taille permise change.

Le numéro d'une carte est vérifié par le contrôle de Luhn : une faute de frappe est signalée avant l'enregistrement.

## Types personnalisés

Vous pouvez décrire vos propres types d'éléments : *Mes types*, dans les outils de la barre latérale.

- **Créer** : un nom (Abonnement, Licence, Véhicule…) et jusqu'à 20 champs.
- **Genre d'un champ** : texte, secret (masqué), texte long, date, nombre, adresse web. Un champ peut être **requis**.
- **À la saisie** : un champ requis vide empêche l'enregistrement, et un nombre, une date ou une adresse mal formés sont refusés.

Les valeurs sont rangées dans les champs de l'élément lui-même : modifier ou supprimer un type ne fait rien perdre, et un élément partagé s'affiche correctement chez quelqu'un qui n'a pas le type.

## Pièce d'identité : recto et verso

Sur un élément de type **Identité**, deux emplacements **Recto** et **Verso** acceptent une photo ou un PDF. Sur téléphone, ils ouvrent directement l'appareil photo. Le fichier est chiffré sur l'appareil, comme toute pièce jointe, et la fiche propose **Voir le recto** / **Voir le verso**.

## Fiche d'un identifiant

Chaque identifiant contient :

- nom du service, URL, identifiant et mot de passe
- secret 2FA (optionnel)
- date d'expiration ou de renouvellement (optionnelle)
- notes
- tags
- champs personnalisés (PIN, question secrète…), masqués ou non
- passkeys importées
- historique des 10 derniers mots de passe

Les actions principales sont en haut de la fiche : **favori**, **Modifier**, et le menu **…** pour créer une tâche liée ou supprimer l'identifiant.

### Copier un mot de passe

Le bouton de copie place le mot de passe dans le presse-papiers. Il est effacé automatiquement après **30 secondes** s'il n'a pas été remplacé entre-temps.

### Expiration

Une date d'expiration affiche un badge **EXP** dans la liste : orange à moins de 14 jours, rouge une fois dépassée.

## Codes 2FA

### Ajouter un secret 2FA

Dans la fiche de modification, le champ **Secret TOTP** accepte :

- un secret Base32 (`JBSWY3DPEHPK3PXP`)
- une URI `otpauth://totp/…` (algorithme, nombre de chiffres et période conservés)

Pour scanner un QR code, cliquez sur **Scanner QR** :

- **Caméra** : présentez le QR code, il est lu automatiquement.
- **Image** : importez une capture d'écran du QR code.

Le décodage est fait localement, aucune image n'est envoyée.

### Utiliser un code

La catégorie **Codes 2FA** liste les identifiants qui ont un secret. Dans la fiche, le code se met à jour en continu avec un compte à rebours ; cliquez dessus pour le copier.

## Générateur

Ouvrez **Générateur** (++ctrl+g++).

=== "Mot de passe"

    - Longueur de 8 à 64 caractères
    - Majuscules, minuscules, chiffres, symboles
    - Option **Sans ambigus** : exclut `0/O` et `1/l/I`

=== "Phrase secrète"

    - 3 à 10 mots tirés de la liste EFF (7 776 mots)
    - Séparateur, majuscule initiale, nombre final

La jauge indique l'entropie réelle : environ 12,9 bits par mot pour une phrase secrète. Appuyez sur ++r++ pour régénérer. Les réglages sont mémorisés.

## Audit de sécurité

**Audit de sécurité** calcule un score à partir :

- des mots de passe faibles
- des mots de passe réutilisés
- des identifiants sans 2FA

Le bouton d'analyse Have I Been Pwned vérifie si les mots de passe apparaissent dans des fuites publiques. Seuls les 5 premiers caractères de l'empreinte SHA-1 de chaque mot de passe sont envoyés (k-anonymat). Si le service est injoignable, l'analyse est signalée comme **incomplète** : l'absence de résultat ne vaut pas absence de fuite.
