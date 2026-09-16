# Compte et synchronisation

Ouvrez **Compte et synchronisation** dans la barre latérale, ou cliquez sur l'état de synchronisation en bas à gauche.

## États de synchronisation

| État | Signification |
| --- | --- |
| Sur cet appareil | Compte local, rien n'est envoyé |
| Synchronisé | Le serveur a la dernière version |
| Modifications en attente | Des changements seront envoyés dans quelques secondes |
| Synchronisation… | Échange en cours |
| Hors ligne | Serveur injoignable ; les changements sont conservés et renvoyés plus tard |
| Erreur de synchronisation | Voir le détail dans la fenêtre Compte |

La synchronisation a lieu à chaque modification, toutes les minutes et au retour de la connexion.

## Plusieurs appareils

Chaque appareil garde une copie chiffrée du coffre et fonctionne hors ligne. Quand deux appareils modifient le coffre en même temps, les changements sont **fusionnés élément par élément** : pour un même identifiant ou une même tâche, la modification la plus récente est conservée ; une suppression l'emporte sur une modification plus ancienne.

## Activer la synchronisation

Pour un compte créé en mode **Cet appareil** :

1. Ouvrez **Compte et synchronisation**.
2. Section **Activer la synchronisation** : saisissez l'adresse du serveur et le mot de passe principal.
3. Cliquez sur **Activer**.

Le coffre existant est envoyé chiffré. Les autres appareils peuvent ensuite se connecter.

## Photo de profil

Onglet **Général** de **Compte et synchronisation**, à côté de l'adresse email. Selon ce que le serveur autorise, vous pouvez :

- **envoyer une image** depuis l'appareil (PNG, JPEG, WebP, GIF ou AVIF) — elle est recadrée en carré à 256 px et réencodée avant l'envoi, ce qui retire au passage les métadonnées de la photo d'origine (position GPS, appareil) ;
- **donner un lien** vers une image déjà hébergée ailleurs, en `https`.

L'image est réservée à votre compte : elle n'est servie à personne d'autre, y compris dans un coffre partagé. **Retirer** la supprime du serveur.

Un serveur peut refuser l'une ou l'autre possibilité, ou les deux ; voir [`AVATAR_UPLOADS` et `AVATAR_URLS`](../deploiement/configuration.md#photo-de-profil). Sur un compte **Cet appareil**, la photo reste sur l'appareil.

## Changer le mot de passe principal

1. Section **Changer le mot de passe principal** : mot de passe actuel, nouveau mot de passe, confirmation.
2. Cliquez sur **Changer le mot de passe**.

Le coffre n'est pas re-chiffré : seule sa clé est protégée par le nouveau mot de passe. Pour un compte synchronisé, les autres appareils sont déconnectés et affichent un message demandant de se reconnecter avec le nouveau mot de passe (menu **Se déconnecter de cet appareil**, puis **Se connecter**).

## Se déconnecter d'un appareil

**Se déconnecter de cet appareil** retire le compte et ses données chiffrées de l'appareil.

- **Compte synchronisé** : le coffre reste sur le serveur. BetterVault tente d'envoyer les dernières modifications avant et prévient si elles n'ont pas pu l'être.
- **Compte local** : les données sont **définitivement supprimées**. Faites un [export chiffré](import-export.md#exporter) avant.

## Supprimer le compte en ligne

Section **Supprimer le compte en ligne** : après confirmation avec le mot de passe principal, le coffre est supprimé du serveur. Les données restent sur l'appareil, qui repasse en compte local.
