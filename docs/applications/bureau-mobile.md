# Applications de bureau et mobile

Les applications utilisent [Tauri 2](https://v2.tauri.app) : la même interface que le site, avec un cœur Rust.

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

### Interface

Sur téléphone, la navigation passe dans une barre en bas de l'écran (identifiants, codes 2FA, bouton d'ajout, tâches, menu). Les fiches s'ouvrent en plein écran et les fenêtres deviennent des panneaux glissant du bas. Les marges tiennent compte de l'encoche et de la barre de gestes.

### Spécificités

- Le scan des QR codes 2FA utilise la caméra : Android demande l'autorisation au premier scan. Sur iOS, ajoutez `NSCameraUsageDescription` dans `src-tauri/gen/apple/bettervault_iOS/Info.plist` après `tauri ios init`.
- Les exports sont enregistrés dans le dossier Documents de l'application.
- Le trousseau du système est disponible sur iOS (Keychain), pas encore sur Android (Keystore non relié).
- Un serveur accessible en HTTPS est nécessaire : `127.0.0.1` désigne le téléphone lui-même.
