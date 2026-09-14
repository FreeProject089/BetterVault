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
