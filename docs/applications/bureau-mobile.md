# Applications de bureau et mobile

Les applications utilisent [Tauri 2](https://v2.tauri.app) : la même interface que le site, avec un cœur Rust.

## Ce qui existe par plateforme

| Plateforme | Installation | Déverrouillage rapide | Remplissage des formulaires |
| --- | --- | --- | --- |
| Windows | Installeur `.msi` / `.exe` | Windows Hello | Extension de navigateur |
| macOS | `.dmg` | Touch ID | Extension de navigateur |
| Linux | `.deb`, `.AppImage` | Mot de passe principal | Extension de navigateur |
| Android | APK, ou installation depuis le navigateur | Empreinte ou visage | Service de remplissage Android |
| iOS, iPadOS | Xcode, ou ajout à l'écran d'accueil | Face ID ou Touch ID | Extension de mots de passe iOS |
| Navigateur | Aucune | Mot de passe principal | Extension de navigateur |

!!! tip "Sur téléphone, sans rien construire"
    La version web s'installe comme une application : **Chrome sur Android** propose « Installer l'application », **Safari sur iOS** propose « Sur l'écran d'accueil ». L'application obtenue s'ouvre sans barre d'adresse, garde ses données hors ligne et se met à jour avec le serveur. C'est le chemin le plus simple ; les projets natifs servent surtout au remplissage automatique du système et au déverrouillage biométrique.

### Construire sur la bonne machine

Chaque système se construit chez lui : Tauri ne fabrique pas un `.dmg` depuis Windows, ni un APK signé sans le SDK Android.

| Cible | Machine nécessaire |
| --- | --- |
| Windows | Windows |
| macOS, iOS | macOS avec Xcode |
| Linux | Linux (ou un conteneur Linux) |
| Android | Windows, macOS ou Linux, avec SDK et NDK Android |

## Bureau (Windows, macOS, Linux)

### Prérequis

- Node.js 24
- [Rust](https://rustup.rs)
- Dépendances système Tauri : [liste par plateforme](https://v2.tauri.app/start/prerequisites/)

### Lancer en développement

```bash
npm install
```

```bash
npm run tauri dev
```

### Construire les installeurs

```bash
npm run tauri build
```

Les installeurs sont générés dans `src-tauri/target/release/bundle/` (`.msi` / `.exe` sous Windows, `.dmg` sous macOS, `.deb` / `.AppImage` sous Linux).

### Spécificités

- Argon2id est calculé en Rust natif.
- Les exports sont enregistrés dans le dossier **Téléchargements**.
- Adresse de serveur par défaut : `http://127.0.0.1:8787`.
- **Windows et macOS** : le déverrouillage rapide s'appuie sur Windows Hello ou Touch ID, et la clé du coffre est rangée dans le trousseau du système.
- **Linux** : pas de biométrie reliée ; le mot de passe principal est demandé à chaque déverrouillage. Le reste est identique.
- **macOS** : une application distribuée hors App Store doit être signée et notariée, sinon Gatekeeper la bloque au premier lancement.

## Mobile (Android, iOS)

### Prérequis

=== "Android"

    - Android Studio avec SDK et NDK
    - Variables `ANDROID_HOME` et `NDK_HOME`
    - Cibles Rust :

    ```bash
    rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
    ```

=== "iOS (macOS uniquement)"

    - Xcode
    - Cibles Rust :

    ```bash
    rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
    ```

### Initialiser le projet natif

```bash
npm run tauri android init
```

```bash
npm run tauri ios init
```

### Lancer

```bash
npm run tauri android dev
```

```bash
npm run tauri ios dev
```

### Construire

```bash
npm run tauri android build
```

```bash
npm run tauri ios build
```

!!! warning "Windows : « Unable to establish loopback connection »"
    Si Gradle échoue avec ce message, Java n'arrive pas à créer ses sockets locales dans le dossier temporaire. Utilisez un dossier simple :

    ```powershell
    New-Item -ItemType Directory -Force C:\gradle-tmp
    $env:TEMP='C:\gradle-tmp'; $env:TMP='C:\gradle-tmp'
    $env:JAVA_TOOL_OPTIONS='-Djdk.net.unixdomain.tmpdir=C:\gradle-tmp'
    npm run tauri android build -- --apk --target aarch64
    ```

    L'APK est créé dans `src-tauri/gen/android/app/build/outputs/apk/universal/release/`. Il n'est pas signé : signez-le avec `apksigner` (ou configurez une clé dans Android Studio) avant de l'installer.

### Interface sur téléphone

- La navigation passe dans une barre en bas de l'écran : identifiants, codes 2FA, bouton d'ajout, tâches, menu.
- Les fiches s'ouvrent en plein écran ; les fenêtres deviennent des panneaux glissant du bas, dont les boutons restent au pouce.
- Les marges tiennent compte de l'encoche et de la barre de gestes (`safe-area`), en portrait comme en paysage.
- Tout ce qui se touche fait au moins 44 px, et les champs s'affichent en 16 px pour que le navigateur n'agrandisse pas la page au moment de la saisie.
- « Tirer pour rafraîchir » est désactivé : un rechargement reverrouillerait le coffre.

### Spécificités

- Le scan des QR codes 2FA utilise la caméra : Android demande l'autorisation au premier scan. Sur iOS, ajoutez `NSCameraUsageDescription` dans `src-tauri/gen/apple/bettervault_iOS/Info.plist` après `tauri ios init`.
- Les exports sont enregistrés dans le dossier Documents de l'application.
- Le trousseau du système est disponible sur iOS (Keychain), pas encore sur Android (Keystore non relié).
- Un serveur accessible en HTTPS est nécessaire : `127.0.0.1` désigne le téléphone lui-même.
