# Biométrie et remplissage automatique

## Déverrouillage biométrique

**Compte et synchronisation > Cet appareil > Déverrouillage biométrique**, puis confirmez avec le mot de passe principal.

| Plateforme | Méthode | Où est gardé le secret |
| --- | --- | --- |
| Android | Empreinte ou visage (biométrie forte) | Android Keystore : clé RSA utilisable seulement après authentification, invalidée si une empreinte est ajoutée |
| Windows | Windows Hello (visage, empreinte ou code PIN) | Gestionnaire d'identification Windows |
| iOS | Face ID ou Touch ID | Trousseau iOS (code écrit, à tester sur Mac) |
| macOS, Linux, navigateur, extension | Non disponible | |

Fonctionnement : un secret aléatoire, gardé par l'appareil, chiffre la clé du coffre. Le mot de passe principal reste toujours utilisable. Changer le mot de passe principal désactive le déverrouillage biométrique : réactivez-le ensuite.

## Remplissage automatique sur Android

1. **Compte et synchronisation > Cet appareil > Choisir BetterVault dans Android** : sélectionnez BetterVault comme service de saisie automatique.
2. **Préparer les identifiants** : l'application écrit un cache chiffré pour le Keystore. Il est mis à jour à chaque modification.
3. Dans une application ou un navigateur, touchez un champ de connexion puis **Déverrouiller BetterVault** : après l'empreinte, les identifiants du site s'affichent.

Correspondance :

- **Sites** : le domaine de la page doit correspondre au site de l'identifiant (sous-domaines compris).
- **Applications** : indiquez `androidapp://nom.du.paquet` comme site de l'identifiant (ex. `androidapp://com.twitter.android`).

**Arrêter** supprime le cache de l'appareil. Aucun identifiant n'est lisible par le service de remplissage sans authentification biométrique.

## Remplissage automatique sur iOS

Le code de l'extension « AutoFill Credential Provider » est dans `src-tauri/ios-extension/`. Il demande un Mac :

1. `npm run tauri ios init`, puis ouvrez le projet Xcode généré.
2. Ajoutez une cible **AutoFill Credential Provider Extension** et remplacez son contrôleur par `CredentialProviderViewController.swift`.
3. Activez la capacité **AutoFill Credential Provider** et le groupe de trousseau `group.app.bettervault` sur l'application et l'extension.
4. Ajoutez `NSFaceIDUsageDescription` dans `Info.plist`.

!!! warning "Non testé"
    Cette extension n'a pas pu être compilée sur la machine de développement (Windows). L'écriture du cache dans le trousseau partagé côté application reste à brancher sur iOS.
