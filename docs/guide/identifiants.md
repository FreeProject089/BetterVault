# Identifiants et 2FA

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
