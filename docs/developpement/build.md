# Construire l'application

BetterVault se décline en six paquets, tous construits à partir des mêmes sources : application web, extension de navigateur, image Docker du serveur, application de bureau, application Android et application iOS.

Cette page décrit ce qu'il faut installer et la commande à lancer pour chacun.

!!! tip "Tout construire sans rien publier"
    Si vous voulez seulement vérifier que les chaînes de build fonctionnent, lancez le workflow **Release** à la main depuis GitHub en laissant l'option « Publier » décochée : il construit les paquets bureau, l'APK Android et l'archive de l'extension, puis les dépose en artefacts téléchargeables sans créer de release.

## Prérequis communs

| Outil | Version | Utilisé par |
| --- | --- | --- |
| Node.js | 24 ou plus | Tout : web, extension, serveur, et l'étape web des paquets natifs |
| Rust | stable | Bureau, Android, iOS |

```bash
npm ci
```

Le serveur, lui, n'a besoin d'aucune dépendance : il n'utilise que les modules intégrés de Node.js, y compris `node:sqlite`. C'est pourquoi l'image Docker de production ne contient pas de `node_modules`.

## Application web

```bash
npm run build
```

Le résultat est dans `dist/`. C'est ce dossier que le serveur sert quand `BETTERVAULT_STATIC` le désigne, et c'est aussi ce que Tauri embarque dans les applications natives.

Pour travailler avec rechargement à chaud :

```bash
npm run dev
```

## Extension de navigateur

```bash
npm run build:extension
```

Le résultat est dans `dist-extension/`, avec son `manifest.json`. L'extension est en manifeste v3 et fonctionne dans Chrome, Edge et Firefox.

Pour la charger sans la publier :

- **Chrome / Edge** : `chrome://extensions` → activer le mode développeur → **Charger l'extension non empaquetée** → choisir `dist-extension/`.
- **Firefox** : `about:debugging` → **Ce Firefox** → **Charger un module temporaire** → choisir `dist-extension/manifest.json`.

L'extension affiche l'application complète dans trois surfaces, distinguées par le paramètre `?surface=` : `popup`, `panel` (panneau latéral) et `tab`. Le popup est figé à 400 × 600 ; le panneau latéral est fluide.

!!! note "Choix de fichier dans le popup"
    Ouvrir un sélecteur de fichiers ferme le popup, et l'envoi serait perdu. Un clic sur une zone de dépôt ouvre donc l'application dans un onglet, et un message l'explique.

## Image Docker du serveur

```bash
docker build -t bettervault:local .
docker compose up -d
```

Le `Dockerfile` construit d'abord l'application web, puis produit une image finale qui ne contient que `dist/`, les sources du serveur et les pages légales. Elle tourne sous l'utilisateur `node`, expose le port 8787 et déclare un contrôle de santé sur `/api/v1/health`.

Voir [Docker](../deploiement/docker.md) pour la mise en service.

## Application de bureau

Tauri 2 produit les paquets natifs. L'étape web (`npm run build`) est lancée automatiquement par `beforeBuildCommand`.

```bash
npx tauri build
```

### Ce qu'il faut installer

=== "Windows"

    - **Visual Studio Build Tools** avec la charge de travail C++
    - **WebView2** (déjà présent sur Windows 11)
    - **WiX Toolset v3** pour produire le `.msi` ; NSIS est fourni par Tauri

    Produit `BetterVault_<version>_x64_en-US.msi` et `BetterVault_<version>_x64-setup.exe` dans `src-tauri/target/release/bundle/`.

=== "macOS"

    - **Xcode Command Line Tools**
    - Pour une application universelle, les deux cibles :

    ```bash
    rustup target add aarch64-apple-darwin x86_64-apple-darwin
    npx tauri build --target aarch64-apple-darwin
    ```

    Produit un `.app` et un `.dmg`. La signature et la notarisation sont facultatives : renseignez les secrets `APPLE_*` décrits dans le workflow de release.

=== "Linux"

    ```bash
    sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
      librsvg2-dev patchelf libdbus-1-dev libssl-dev
    npx tauri build
    ```

    Produit un `.deb`, un `.rpm` et un `AppImage`.

!!! warning "Pas de compilation croisée"
    Chaque système construit son propre paquet : on ne produit pas un paquet macOS depuis Windows. C'est pour cela que le workflow de release utilise trois machines différentes.

### Ce que la partie Rust apporte

Le cœur Rust (`src-tauri/src/lib.rs`) n'est pas qu'une coquille autour de la page web. Il fournit :

- **Argon2id natif**, bien plus rapide que l'implémentation WebAssembly ;
- le **trousseau du système** (Windows Credential Manager, trousseau macOS, Secret Service) ;
- **Windows Hello** et **Touch ID** pour le déverrouillage biométrique ;
- l'ouverture des liens dans le navigateur du système.

## Application Android

```bash
npx tauri android build --apk
```

### Ce qu'il faut installer

- **JDK 17**
- **Android SDK** et un **NDK** (le workflow utilise `27.1.12297006`)
- Les quatre cibles Rust :

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi \
  i686-linux-android x86_64-linux-android
```

Il faut aussi que `ANDROID_HOME` et `NDK_HOME` pointent vers le SDK et le NDK.

L'APK non signé sort dans `src-tauri/gen/android/`. Pour le signer, le workflow de release utilise `zipalign` puis `apksigner` avec les secrets `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD` et `ANDROID_KEY_ALIAS`.

Le déverrouillage biométrique passe par le Keystore Android (`BetterVaultPlugin.kt`) et non par le trousseau, que la bibliothèque `keyring` ne prend pas en charge sur Android.

## Application iOS

L'application iOS demande **un Mac avec Xcode** et n'est pas construite automatiquement.

```bash
rustup target add aarch64-apple-ios
npx tauri ios init      # une seule fois : génère le projet Xcode
npx tauri ios build
```

L'extension **AutoFill Credential Provider** — celle qui propose les identifiants de BetterVault dans les autres applications — s'ajoute à la main dans Xcode : voir [Biométrie et remplissage automatique](../applications/biometrie-autofill.md). Son contrôleur est dans `src-tauri/ios-extension/`.

L'intégration continue ne construit pas l'application iOS, mais elle vérifie sur un runner macOS que la partie Rust compile bien pour `aarch64-apple-ios`.

## Vérifications avant de publier

```bash
npm run typecheck    # application et serveur
npm test             # Vitest
npm run build
npm run build:extension
npm run docs:build   # mkdocs --strict
cd src-tauri && cargo clippy --locked --all-targets -- -D warnings
```

L'intégration continue lance exactement ces contrôles, plus un démarrage réel de l'image Docker qui interroge `/api/v1/health`, la page d'administration et les pages légales dans les deux langues.

## Publier une version

```bash
git tag v1.2.0
git push origin v1.2.0
```

Le workflow **Release** construit et publie alors : l'image Docker multi-architecture sur GHCR, les paquets bureau pour les trois systèmes, l'APK Android et l'archive de l'extension. Les releases sont créées en **brouillon** : rien n'est visible tant que vous ne les publiez pas vous-même.
