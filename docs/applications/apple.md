# Fabriquer les fichiers pour macOS et iOS

Cette page est la marche à suivre quand vous avez un Mac sous la main. Tout le
code Apple est déjà dans le dépôt (Touch ID, Face ID, trousseau, extension de
mots de passe) ; ce qui manque, c'est une machine Apple pour le compiler et le
signer. Rien de tout cela ne peut se faire depuis Windows ou Linux : Xcode
n'existe que sur macOS, et Apple n'accepte que des fichiers signés par ses
outils.

!!! tip "Sans Mac, il reste un chemin complet"
    Sur iPhone, iPad et Mac, **Safari installe déjà BetterVault comme une
    application** depuis l'adresse de votre serveur : *Partager → Sur l'écran
    d'accueil* (iOS) ou *Fichier → Ajouter au Dock* (macOS). Même interface,
    données hors ligne, pas de fichier à distribuer. Ce qui manque par rapport
    au projet natif : Face ID / Touch ID relié au trousseau et le remplissage
    automatique du système.

## Ce qu'il vous faut

| Élément | Pourquoi | Coût |
| --- | --- | --- |
| Un Mac (Apple Silicon ou Intel) | Xcode, la signature et le simulateur iOS n'existent que là | — |
| Xcode, depuis le Mac App Store | Compile, signe et fabrique les fichiers | Gratuit |
| Un identifiant Apple | Suffit pour installer sur **vos** appareils | Gratuit |
| Un compte Apple Developer | Obligatoire pour distribuer à d'autres personnes (notarisation, TestFlight, App Store) | 99 $/an |
| Node.js 24, Rust, les cibles Rust Apple | Le cœur de l'application | Gratuit |

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim
```

## macOS : le fichier `.dmg`

C'est le cas simple : un seul fichier, que l'on télécharge et que l'on glisse
dans les Applications.

```bash
npm install
```

```bash
npm run tauri build
```

Le fichier sort dans `src-tauri/target/release/bundle/dmg/`.

!!! warning "Sans signature, macOS refuse de l'ouvrir"
    Un `.dmg` non signé déclenche « ne peut pas être ouvert car son
    développeur ne peut pas être vérifié ». Pour vos propres machines, un
    clic droit → *Ouvrir* suffit à passer outre. Pour le distribuer, il faut
    signer puis **notariser** avec un compte Apple Developer :

    ```bash
    xcrun notarytool submit BetterVault.dmg \
      --apple-id vous@exemple.fr --team-id VOTREEQUIPE --wait
    ```

    ```bash
    xcrun stapler staple BetterVault.dmg
    ```

Les variables `APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD` et `APPLE_TEAM_ID` permettent à `npm run tauri build` de tout
faire d'un coup ; la [documentation Tauri](https://v2.tauri.app/distribute/sign/macos/)
donne la liste exacte.

## iOS : il n'y a pas de fichier à télécharger

C'est la limite d'Apple, pas la nôtre : sur iPhone et iPad, **aucun fichier ne
s'installe depuis un site web**. Un `.ipa` n'est pas un `.dmg`. Trois chemins
existent, selon les personnes à qui vous le donnez.

### 1. Pour vous et quelques appareils : Xcode

```bash
npm run tauri ios init
```

```bash
npm run tauri ios dev
```

Xcode installe directement sur l'iPhone branché. Avec un identifiant Apple
gratuit, l'application expire au bout de 7 jours et il faut la réinstaller.

### 2. Pour des testeurs : TestFlight

```bash
npm run tauri ios build
```

Le `.ipa` sort dans `src-tauri/gen/apple/build/`. Vous l'envoyez à App Store
Connect (Xcode → *Product → Archive → Distribute*), et TestFlight donne **un
lien** à partager : vos testeurs installent depuis l'application TestFlight,
jusqu'à 10 000 personnes, sans passer par la validation App Store complète.
C'est le plus proche d'un « fichier à télécharger » qui existe sur iOS.

### 3. Pour tout le monde : App Store

Même archive, soumise à la validation. Comptez quelques jours et une revue
attentive : un gestionnaire de mots de passe doit expliquer son chiffrement et
sa politique de confidentialité (la page `/legal` de votre serveur y répond).

### À faire après `tauri ios init`

Le projet Xcode est généré, pas versionné : ces deux réglages sont à refaire.

- **Caméra** (scan des QR codes 2FA) : ajoutez `NSCameraUsageDescription` dans
  `src-tauri/gen/apple/bettervault_iOS/Info.plist`.
- **Remplissage automatique** : ajoutez la cible *Credential Provider
  Extension* et reliez-y `src-tauri/ios-extension/CredentialProviderViewController.swift`.
  L'en-tête du fichier décrit les cases à cocher.

## Ce qui marche ensuite, sans rien configurer

| Fonction | macOS | iOS |
| --- | --- | --- |
| Déverrouillage rapide | Touch ID | Face ID ou Touch ID |
| Secret rangé dans | Trousseau macOS | Trousseau iOS |
| Remplissage des formulaires | Extension de navigateur | Extension de mots de passe iOS |
| Scan d'un QR code 2FA | Caméra du Mac | Caméra, après `NSCameraUsageDescription` |

Le reste — chiffrement, synchronisation, coffres partagés, pièces jointes — est
le même code que sur les autres systèmes. [Biométrie et remplissage
automatique](biometrie-autofill.md) détaille ce qui se passe sous le capot.
